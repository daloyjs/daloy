import type { App } from "../app.js";
import { setConnInfo } from "../conn-info.js";

/**
 * AWS Lambda / Netlify Functions adapter.
 *
 * Supports API Gateway HTTP API (payload format v2.0), Lambda Function URLs,
 * API Gateway REST API (payload format v1.0), and Netlify Functions.
 *
 *   // handler.ts (Netlify Functions / Lambda @ Function URL)
 *   import { toLambdaHandler } from "@daloyjs/core/lambda";
 *   import { app } from "./server.js";
 *   export const handler = toLambdaHandler(app);
 *
 * The adapter performs no Node-only I/O, so it is safe in any runtime that
 * provides the standard `Request`/`Response`/`atob`/`btoa` globals.
 */

/** API Gateway REST API event (payload format v1.0). */
export interface LambdaEventV1 {
  /** Payload format version; `"1.0"` or absent for REST API events. */
  version?: "1.0" | string;
  /** URL path of the request (e.g. `/users/42`). */
  path?: string;
  /** HTTP method (e.g. `GET`). */
  httpMethod?: string;
  /** Request headers, one value per name (last value wins in v1.0). */
  headers?: Record<string, string | undefined>;
  /** Request headers with every value per name; `cookie` values are re-joined with `; `. */
  multiValueHeaders?: Record<string, string[] | undefined>;
  /** Query parameters, one value per name. Used only when the multi-value map is empty. */
  queryStringParameters?: Record<string, string | undefined> | null;
  /** Query parameters with every value per name; preferred over the single-value map. */
  multiValueQueryStringParameters?: Record<string, string[] | undefined> | null;
  /** Request context; `domainName` is the host fallback, `path` the path fallback, and `identity.sourceIp` the caller address seen by API Gateway. */
  requestContext?: {
    domainName?: string;
    path?: string;
    identity?: { sourceIp?: string };
  };
  /** Raw request body; base64-encoded when {@link LambdaEventV1.isBase64Encoded} is true. */
  body?: string;
  /** True when `body` is base64-encoded (binary payloads). */
  isBase64Encoded?: boolean;
}

/** API Gateway HTTP API or Lambda Function URL event (payload format v2.0). */
export interface LambdaEventV2 {
  /** Payload format version; `"2.0"` for HTTP API / Function URL events. */
  version?: string;
  /** URL path of the request, without the query string. */
  rawPath?: string;
  /** Raw query string without the leading `?` (empty string when none). */
  rawQueryString?: string;
  /** Request headers; multi-value headers arrive comma-joined in v2.0. */
  headers?: Record<string, string | undefined>;
  /** Request cookies as individual strings; re-joined with `; ` into a `cookie` header. */
  cookies?: string[];
  /** Request context; `http.method`/`http.path` carry the method and path, `http.sourceIp` the caller address, `domainName` the host fallback. */
  requestContext?: {
    http?: { method?: string; path?: string; sourceIp?: string };
    domainName?: string;
  };
  /** Raw request body; base64-encoded when {@link LambdaEventV2.isBase64Encoded} is true. */
  body?: string;
  /** True when `body` is base64-encoded (binary payloads). */
  isBase64Encoded?: boolean;
}

/** Either payload format accepted by {@link toLambdaHandler}. */
export type LambdaEvent = LambdaEventV1 | LambdaEventV2;

/** Lambda response shape required by API Gateway REST API (payload format v1.0). */
export interface LambdaResponseV1 {
  /** HTTP status code of the response. */
  statusCode: number;
  /** Response headers, one value per name (`set-cookie` excluded; see `multiValueHeaders`). */
  headers: Record<string, string>;
  /** Multi-value headers; used to carry each `set-cookie` value separately in v1.0. */
  multiValueHeaders?: Record<string, string[]>;
  /** Never present in v1.0 responses; cookies travel via `multiValueHeaders`. */
  cookies?: never;
  /** Response body; base64-encoded when {@link LambdaResponseV1.isBase64Encoded} is true. */
  body: string;
  /** True when `body` is base64-encoded (non-text content types). */
  isBase64Encoded: boolean;
}

/** Lambda response shape required by API Gateway HTTP API and Function URLs (payload format v2.0). */
export interface LambdaResponseV2 {
  /** HTTP status code of the response. */
  statusCode: number;
  /** Response headers, one value per name (`set-cookie` excluded; see `cookies`). */
  headers: Record<string, string>;
  /** Response cookies, one `set-cookie` value per entry (v2.0's cookie channel). */
  cookies?: string[];
  /** Never present in v2.0 responses; cookies travel via `cookies`. */
  multiValueHeaders?: never;
  /** Response body; base64-encoded when {@link LambdaResponseV2.isBase64Encoded} is true. */
  body: string;
  /** True when `body` is base64-encoded (non-text content types). */
  isBase64Encoded: boolean;
}

/** Either response shape produced by {@link toLambdaHandler}, chosen automatically per event. */
export type LambdaResponse = LambdaResponseV1 | LambdaResponseV2;
/** Async handler shape consumed by AWS Lambda / Netlify Functions runtimes. */
export type LambdaHandler = (event: LambdaEvent) => Promise<LambdaResponse>;

/**
 * Writable response stream supplied to a response-streaming AWS Lambda handler.
 *
 * The contract intentionally models only the Node.js writable-stream methods
 * used by DaloyJS, keeping the adapter free of Node-only imports while still
 * respecting backpressure.
 */
export interface LambdaResponseStream {
  /** Writes one response chunk and returns false when the producer must wait for `drain`. */
  write(chunk: Uint8Array): boolean;
  /** Ends the response after every previously written chunk has flushed. */
  end(): void;
  /** Registers a one-shot writable-stream event listener. */
  once(event: "drain", listener: () => void): this;
  /** Registers a one-shot writable-stream error listener. */
  once(event: "error", listener: (error: Error) => void): this;
  /** Removes a previously registered drain listener when supported. */
  off?(event: "drain", listener: () => void): this;
  /** Removes a previously registered error listener when supported. */
  off?(event: "error", listener: (error: Error) => void): this;
  /** Resolves when AWS has flushed the ended response stream, when provided by the runtime. */
  finished?(): Promise<void>;
}

/** HTTP response metadata accepted by `awslambda.HttpResponseStream.from()`. */
export interface LambdaStreamMetadata {
  /** HTTP response status code. */
  statusCode: number;
  /** Single-value response headers, excluding `set-cookie`. */
  headers: Record<string, string>;
  /** Multi-value response headers, used to preserve every `set-cookie` value. */
  multiValueHeaders?: Record<string, string[]>;
}

/** Async response-streaming handler shape consumed by the AWS Lambda Node.js runtime. */
export type LambdaStreamHandler = (
  event: LambdaEvent,
  responseStream: LambdaResponseStream,
  context?: unknown
) => Promise<void>;

interface LambdaStreamingRuntime {
  streamifyResponse(handler: LambdaStreamHandler): LambdaStreamHandler;
  HttpResponseStream: {
    from(stream: LambdaResponseStream, metadata: LambdaStreamMetadata): LambdaResponseStream;
  };
}

const TEXT_TYPE_RE =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|.*\+json|.*\+xml))/i;

/**
 * Wrap an {@link App} as a Lambda/Netlify handler accepting either v1.0 or v2.0 event payloads.
 *
 * A malformed event (e.g. a `Host`/path combination that cannot form a valid
 * URL) is answered with a clean `400` problem+json instead of throwing out of
 * the handler, which API Gateway would otherwise surface as an opaque `502`.
 *
 * @param app - The DaloyJS {@link App} that serves each translated request.
 * @returns A {@link LambdaHandler} that converts the event to a `Request`, calls {@link App.fetch}, and emits the matching v1.0/v2.0 response shape.
 */
export function toLambdaHandler(app: App): LambdaHandler {
  return async (event) => {
    let request: Request;
    try {
      request = eventToRequest(event);
    } catch {
      return responseToLambda(badRequestResponse(), isV2Event(event));
    }
    const response = await app.fetch(request);
    return responseToLambda(response, isV2Event(event));
  };
}

/**
 * Wrap an {@link App} as an AWS Lambda response-streaming handler.
 *
 * The returned handler is decorated with the managed Node.js runtime's
 * `awslambda.streamifyResponse()` helper, attaches status/headers with
 * `HttpResponseStream.from()`, and pumps the web-standard response body while
 * honoring writable-stream backpressure. The function throws during startup
 * outside an AWS Lambda Node.js runtime so an accidentally buffered or broken
 * deployment cannot start silently.
 *
 * @param app - The DaloyJS {@link App} that serves each translated request.
 * @returns A response-streaming Lambda handler for Function URLs, API Gateway streaming proxy integrations, or `InvokeWithResponseStream`.
 * @throws {Error} If the AWS Lambda response-streaming globals are unavailable.
 */
export function toLambdaStreamHandler(app: App): LambdaStreamHandler {
  const runtime = lambdaStreamingRuntime();
  return runtime.streamifyResponse(async (event, rawStream) => {
    let request: Request;
    try {
      request = eventToRequest(event);
    } catch {
      await streamLambdaResponse(badRequestResponse(), rawStream, runtime);
      return;
    }
    await streamLambdaResponse(await app.fetch(request), rawStream, runtime);
  });
}

function eventToRequest(event: LambdaEvent): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (v === undefined) continue;
    headers.set(k, v);
  }

  if ("multiValueHeaders" in event) {
    for (const [k, values] of Object.entries(event.multiValueHeaders ?? {})) {
      if (!values?.length) continue;
      headers.set(k, k.toLowerCase() === "cookie" ? values.join("; ") : values.join(", "));
    }
  }
  if ("cookies" in event && event.cookies?.length) headers.set("cookie", event.cookies.join("; "));

  const method = isV2Event(event)
    ? (event.requestContext?.http?.method ?? "GET")
    : (event.httpMethod ?? "GET");
  const rawPath = isV2Event(event)
    ? (event.rawPath ?? event.requestContext?.http?.path ?? "/")
    : (event.path ?? event.requestContext?.path ?? "/");
  const host = headers.get("host") ?? event.requestContext?.domainName ?? "localhost";
  const proto = headers.get("x-forwarded-proto") ?? "https";
  const rawQueryString = isV2Event(event) ? (event.rawQueryString ?? "") : queryStringForV1(event);
  const qs = rawQueryString ? `?${rawQueryString}` : "";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const url = `${proto}://${host}${path}${qs}`;

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && event.body != null) {
    init.body = event.isBase64Encoded ? (base64ToBytes(event.body) as BodyInit) : event.body;
  }
  const request = new Request(url, init);
  // Fulfil the conn-info contract with the caller address API Gateway saw
  // (v2: `requestContext.http.sourceIp`, v1: `requestContext.identity.sourceIp`),
  // so `getConnInfo` / `resolveClientIp` work on Lambda. API Gateway and
  // Function URLs only serve TLS.
  const sourceIp = isV2Event(event)
    ? event.requestContext?.http?.sourceIp
    : event.requestContext?.identity?.sourceIp;
  if (sourceIp) {
    setConnInfo(request, { remoteAddress: sourceIp, tls: true });
  }
  return request;
}

async function responseToLambda(res: Response, useV2Response: boolean): Promise<LambdaResponse> {
  const { headers, cookies } = responseHeaders(res);

  const contentType = res.headers.get("content-type") ?? "";
  const isText = TEXT_TYPE_RE.test(contentType);

  let body = "";
  let isBase64Encoded = false;
  if (res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 0) {
      if (isText) {
        body = new TextDecoder().decode(buf);
      } else {
        body = bytesToBase64(buf);
        isBase64Encoded = true;
      }
    }
  }

  const out = {
    statusCode: res.status,
    headers,
    body,
    isBase64Encoded,
  };
  if (!cookies.length) return out;
  if (useV2Response) return { ...out, cookies };
  return { ...out, multiValueHeaders: { "set-cookie": cookies } };
}

function isV2Event(event: LambdaEvent): event is LambdaEventV2 {
  const requestContext = event.requestContext as { http?: unknown } | undefined;
  return (
    event.version === "2.0" ||
    "rawPath" in event ||
    "rawQueryString" in event ||
    !!requestContext?.http
  );
}

function queryStringForV1(event: LambdaEventV1): string {
  const values = new URLSearchParams();
  for (const [key, list] of Object.entries(event.multiValueQueryStringParameters ?? {})) {
    for (const value of list ?? []) values.append(key, value);
  }
  if (values.size > 0) return values.toString();
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined) values.append(key, value);
  }
  return values.toString();
}

function cookieFallback(headers: Headers): string[] {
  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

function responseHeaders(res: Response): { headers: Record<string, string>; cookies: string[] } {
  const headers: Record<string, string> = {};
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : cookieFallback(res.headers);
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") headers[key] = value;
  });
  return { headers, cookies };
}

function badRequestResponse(): Response {
  return Response.json(
    {
      type: "https://daloyjs.dev/errors/bad-request",
      title: "Bad Request",
      status: 400,
    },
    { status: 400, headers: { "content-type": "application/problem+json" } }
  );
}

function lambdaStreamingRuntime(): LambdaStreamingRuntime {
  const runtime = (globalThis as typeof globalThis & { awslambda?: LambdaStreamingRuntime })
    .awslambda;
  if (
    !runtime ||
    typeof runtime.streamifyResponse !== "function" ||
    typeof runtime.HttpResponseStream?.from !== "function"
  ) {
    throw new Error(
      "AWS Lambda response streaming runtime not detected; toLambdaStreamHandler requires the managed Node.js awslambda globals"
    );
  }
  return runtime;
}

async function streamLambdaResponse(
  response: Response,
  rawStream: LambdaResponseStream,
  runtime: LambdaStreamingRuntime
): Promise<void> {
  const { headers, cookies } = responseHeaders(response);
  const metadata: LambdaStreamMetadata = { statusCode: response.status, headers };
  if (cookies.length) metadata.multiValueHeaders = { "set-cookie": cookies };
  const responseStream = runtime.HttpResponseStream.from(rawStream, metadata);

  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!responseStream.write(chunk.value)) await waitForDrain(responseStream);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  responseStream.end();
  if (responseStream.finished) await responseStream.finished();
}

function waitForDrain(stream: LambdaResponseStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = (): void => {
      stream.off?.("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      stream.off?.("drain", onDrain);
      reject(error);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
