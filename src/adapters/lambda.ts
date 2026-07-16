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

const TEXT_TYPE_RE = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|.*\+json|.*\+xml))/i;

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
      return {
        statusCode: 400,
        headers: { "content-type": "application/problem+json" },
        body: JSON.stringify({
          type: "https://daloyjs.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
        }),
        isBase64Encoded: false,
      };
    }
    const response = await app.fetch(request);
    return responseToLambda(response, isV2Event(event));
  };
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

  const method = isV2Event(event) ? event.requestContext?.http?.method ?? "GET" : event.httpMethod ?? "GET";
  const rawPath = isV2Event(event)
    ? event.rawPath ?? event.requestContext?.http?.path ?? "/"
    : event.path ?? event.requestContext?.path ?? "/";
  const host = headers.get("host") ?? event.requestContext?.domainName ?? "localhost";
  const proto = headers.get("x-forwarded-proto") ?? "https";
  const rawQueryString = isV2Event(event) ? event.rawQueryString ?? "" : queryStringForV1(event);
  const qs = rawQueryString ? `?${rawQueryString}` : "";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const url = `${proto}://${host}${path}${qs}`;

  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && event.body != null) {
    init.body = event.isBase64Encoded
      ? (base64ToBytes(event.body) as BodyInit)
      : event.body;
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
  const headers: Record<string, string> = {};
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies: string[] = typeof getSetCookie === "function"
    ? getSetCookie.call(res.headers)
    : cookieFallback(res.headers);
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });

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
  return event.version === "2.0" || "rawPath" in event || "rawQueryString" in event || !!requestContext?.http;
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
