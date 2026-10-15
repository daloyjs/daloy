/**
 * Azure Functions adapter (Node.js programming model v4).
 *
 * The v4 HTTP trigger hands the handler an `HttpRequest` that looks like a
 * web `Request` but is not one, and expects an `HttpResponseInit` object back.
 * {@link toAzureHandler} converts both directions so the same DaloyJS app runs
 * behind an Azure HTTP trigger:
 *
 *   // src/functions/api.ts
 *   import { app as azure } from "@azure/functions";
 *   import { toAzureHandler } from "@daloyjs/core/azure";
 *   import { app } from "../app.js";
 *
 *   azure.http("api", {
 *     route: "{*path}",
 *     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
 *     authLevel: "anonymous",
 *     handler: toAzureHandler(app),
 *   });
 *
 * The adapter is typed structurally, so `@daloyjs/core` takes no dependency on
 * `@azure/functions`.
 */
import type { App } from "../app.js";

/**
 * Minimal structural view of the Azure Functions v4 `HttpRequest`.
 *
 * Only the members the adapter reads are modelled, so the real
 * `@azure/functions` class is assignable without a type import.
 */
export interface AzureHttpRequestLike {
  /** HTTP method (e.g. `GET`). */
  readonly method: string;
  /** Absolute request URL, as seen by the Functions host. */
  readonly url: string;
  /** Request headers; any `Headers`-compatible object works. */
  readonly headers: {
    forEach(callback: (value: string, key: string) => void): void;
  };
  /** Request body stream, or `null` when the request has none. */
  readonly body: ReadableStream<Uint8Array> | null;
}

/** Cookie shape accepted by the Azure Functions v4 `HttpResponseInit.cookies` channel. */
export interface AzureCookie {
  /** Cookie name. */
  name: string;
  /** Cookie value, passed through verbatim. */
  value: string;
  /** `Domain` attribute. */
  domain?: string;
  /** `Path` attribute. */
  path?: string;
  /** `Expires` attribute. */
  expires?: Date;
  /** `Secure` attribute. */
  secure?: boolean;
  /** `HttpOnly` attribute. */
  httpOnly?: boolean;
  /** `SameSite` attribute. */
  sameSite?: "Strict" | "Lax" | "None";
  /** `Max-Age` attribute, in seconds. */
  maxAge?: number;
}

/** Response object returned to the Azure Functions v4 host (an `HttpResponseInit`). */
export interface AzureHttpResponseInit {
  /** HTTP status code. */
  status: number;
  /** Response headers, one value per name (`set-cookie` travels via {@link AzureHttpResponseInit.cookies}). */
  headers: Record<string, string>;
  /** Every `Set-Cookie` the app produced, parsed into Azure's cookie objects. */
  cookies?: AzureCookie[];
  /** Response body: a stream in streaming mode, otherwise the buffered bytes. Absent when the response has no body. */
  body?: ReadableStream<Uint8Array> | ArrayBuffer;
}

/** HTTP trigger handler shape produced by {@link toAzureHandler}. */
export type AzureHttpHandler = (
  request: AzureHttpRequestLike,
  context?: unknown,
) => Promise<AzureHttpResponseInit>;

/** Options for {@link toAzureHandler}. */
export interface AzureHandlerOptions {
  /**
   * Return the response body as a `ReadableStream` instead of buffering it.
   * Enable this only together with `app.setup({ enableHttpStream: true })`
   * from `@azure/functions`; without that host setting Azure buffers the
   * stream anyway. Default: `false`.
   */
  stream?: boolean;
}

/**
 * Wrap an {@link App} as an Azure Functions v4 HTTP trigger handler.
 *
 * The incoming `HttpRequest` is rebuilt as a web `Request` whose body is the
 * host's body stream, so the app's `bodyLimitBytes` cap is enforced while the
 * body is read rather than after Azure has handed over a buffered copy. A
 * request URL the runtime cannot parse is answered with a `400`
 * problem+json instead of throwing out of the handler.
 *
 * Azure does not expose the TCP peer to the handler, so
 * `getConnInfo(ctx.request)` stays `undefined`; configure `behindProxy` on the App to derive the client
 * IP from the platform's `X-Forwarded-For`.
 *
 * Each `Set-Cookie` value is converted to an {@link AzureCookie} because the
 * Functions host keeps only one value per header name. Attributes Azure cannot
 * represent (`Partitioned`, `Priority`) are dropped, and a malformed
 * `Set-Cookie` with no `name=value` pair is omitted.
 *
 * @param app - The DaloyJS {@link App} that serves each translated request.
 * @param opts - Adapter options; see {@link AzureHandlerOptions}.
 * @returns An {@link AzureHttpHandler} to pass as the `handler` of `app.http()`.
 * @throws Error in production when `app.assertSecureConfig()` finds a boot-guard
 *   violation, so an insecure route table fails at startup, not on the first request.
 */
export function toAzureHandler(
  app: App,
  opts: AzureHandlerOptions = {},
): AzureHttpHandler {
  // Refuse an insecure configuration at cold start (and so at deploy time
  // where the platform validates startup) instead of on the first request.
  app.assertSecureConfig();
  const stream = opts.stream === true;
  return async (azureRequest) => {
    let request: Request;
    try {
      request = toWebRequest(azureRequest);
    } catch {
      return toAzureResponse(badRequestResponse(), false);
    }
    const response = await app.fetch(request);
    // A scaled-in instance gets no shutdown hook; await the export so OTLP
    // leaves the worker. `flush()` never rejects.
    await app.telemetry?.flush();
    return toAzureResponse(response, stream);
  };
}

function toWebRequest(azureRequest: AzureHttpRequestLike): Request {
  const headers = new Headers();
  azureRequest.headers.forEach((value, key) => {
    headers.append(key, value);
  });
  const method = azureRequest.method.toUpperCase();
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD" && azureRequest.body !== null) {
    init.body = azureRequest.body;
    init.duplex = "half";
  }
  return new Request(azureRequest.url, init);
}

async function toAzureResponse(
  res: Response,
  stream: boolean,
): Promise<AzureHttpResponseInit> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  const out: AzureHttpResponseInit = { status: res.status, headers };

  const setCookies = res.headers.getSetCookie();
  if (setCookies.length > 0) {
    const cookies: AzureCookie[] = [];
    for (const raw of setCookies) {
      const cookie = parseSetCookie(raw);
      if (cookie !== undefined) cookies.push(cookie);
    }
    out.cookies = cookies;
  }

  if (res.body !== null) {
    out.body = stream ? res.body : await res.arrayBuffer();
  }
  return out;
}

/** Parse one `Set-Cookie` value; `undefined` when it has no `name=value` pair. */
function parseSetCookie(raw: string): AzureCookie | undefined {
  const parts = raw.split(";");
  const pair = parts[0]!;
  const eq = pair.indexOf("=");
  if (eq <= 0) return undefined;
  const name = pair.slice(0, eq).trim();
  if (name === "") return undefined;
  const cookie: AzureCookie = { name, value: pair.slice(eq + 1).trim() };
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i]!;
    const sep = attr.indexOf("=");
    const key = (sep === -1 ? attr : attr.slice(0, sep)).trim().toLowerCase();
    const value = sep === -1 ? "" : attr.slice(sep + 1).trim();
    if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "path") cookie.path = value;
    else if (key === "domain") cookie.domain = value;
    else if (key === "samesite") {
      const sameSite = value.toLowerCase();
      if (sameSite === "strict") cookie.sameSite = "Strict";
      else if (sameSite === "lax") cookie.sameSite = "Lax";
      else if (sameSite === "none") cookie.sameSite = "None";
    } else if (key === "max-age") {
      if (/^-?\d{1,15}$/.test(value)) cookie.maxAge = Number(value);
    } else if (key === "expires") {
      const expires = new Date(value);
      if (!Number.isNaN(expires.getTime())) cookie.expires = expires;
    }
  }
  return cookie;
}

function badRequestResponse(): Response {
  return Response.json(
    {
      type: "https://daloyjs.dev/errors/bad-request",
      title: "Bad Request",
      status: 400,
    },
    { status: 400, headers: { "content-type": "application/problem+json" } },
  );
}
