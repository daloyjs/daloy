/**
 * Typed client factory.
 *
 * `createClient<typeof app>(...)` produces a typed fetch wrapper whose
 * methods correspond to operationIds, with parameters and response
 * types derived from the *same* route definitions used on the server.
 *
 * One source of truth: server, validation, OpenAPI, and client all
 * line up. No drift, no separate codegen step required (though one
 * can still be generated from the OpenAPI doc for non-TS clients).
 */

import type { App } from "./app.js";
import type {
  HandlerReturn,
  InferRequest,
  ParamsOf,
  RequestSchemas,
  ResponsesMap,
  RouteDefinition,
} from "./types.js";

/** Union of every {@link RouteDefinition} registered on an `App`. */
export type RoutesOf<A extends App> = A["routes"][number];

/**
 * Typed client surface generated from an `App`. The result is a record keyed
 * by each route's `operationId` whose values are async methods inferred from
 * the route's request and response schemas. Required query and header fields
 * remain required on the client input, while schemas that accept an empty
 * object keep their corresponding client field optional.
 *
 * The per-method types are recovered from the `App`'s accumulated route tuple,
 * built by chained registrations or `app.registerRoutes([...])`. If the result
 * is widened back to a bare `App` annotation, the tuple is intentionally erased
 * and this type becomes a string-indexed record.
 */
export type ClientFor<A extends App> = {
  [R in Extract<RoutesOf<A>, { operationId: string }> as R["operationId"]]: ClientMethod<R>;
};

type ClientMethod<R> =
  R extends RouteDefinition<infer P, infer _M, infer Req, infer Res>
    ? {} extends ClientInput<P, Req>
      ? (input?: ClientInput<P, Req>) => Promise<ClientOutput<Res>>
      : (input: ClientInput<P, Req>) => Promise<ClientOutput<Res>>
    : never;

type ClientInput<P extends string, Req extends RequestSchemas | undefined> = ([
  ParamsOf<P>,
] extends [never]
  ? { params?: Record<string, never> }
  : { params: InferRequest<Req, P>["params"] }) &
  ClientQueryInput<P, Req> &
  ClientHeadersInput<P, Req> &
  (Req extends { body: infer _B } ? { body: InferRequest<Req, P>["body"] } : { body?: undefined });

type ClientQueryInput<P extends string, Req extends RequestSchemas | undefined> = Req extends {
  query: infer _Query;
}
  ? {} extends NonNullable<InferRequest<Req, P>["query"]>
    ? { query?: NonNullable<InferRequest<Req, P>["query"]> }
    : { query: NonNullable<InferRequest<Req, P>["query"]> }
  : { query?: Record<string, string | string[] | number | boolean | undefined> };

type ClientHeadersInput<P extends string, Req extends RequestSchemas | undefined> = Req extends {
  headers: infer _Headers;
}
  ? {} extends NonNullable<InferRequest<Req, P>["headers"]>
    ? { headers?: NonNullable<InferRequest<Req, P>["headers"]> }
    : { headers: NonNullable<InferRequest<Req, P>["headers"]> }
  : { headers?: Record<string, string> };

type ClientOutput<Res extends ResponsesMap> = HandlerReturn<Res>;

/** Options for {@link createClient}. */
export interface ClientOptions {
  /** Absolute base URL prepended to every request path. */
  baseUrl: string;
  /** Custom `fetch` implementation (default: global `fetch`). Useful for mocking or proxies. */
  fetch?: typeof fetch;
  /** Default headers merged into every request (per-call `input.headers` wins). */
  headers?: Record<string, string>;
}

/** Options for {@link createInProcessClient}. */
export interface InProcessClientOptions {
  /** Synthetic absolute origin used while constructing requests. Default: `http://daloy.local`. */
  baseUrl?: string;
  /** Default headers merged into every request. Per-call headers win. */
  headers?: Record<string, string>;
}

/**
 * Build a typed fetch client whose methods are keyed by
 * `operationId`. Parameters and response types are inferred from the same
 * route definitions registered on `app`, so the client and server cannot
 * drift apart at the type level.
 * Required `params`, `query`, `headers`, and `body` inputs are preserved from
 * the route contract; query or header schemas that accept an empty object keep
 * those top-level fields optional.
 *
 * The returned object is a plain `Record<operationId, (input) => Promise<...>>`
 * — each call serializes `params`/`query`/`headers`/`body` and dispatches
 * through `opts.fetch` (default: global `fetch`).
 *
 * For non-TypeScript consumers, run `pnpm gen` to emit a fully-typed SDK
 * from the OpenAPI document instead.
 * Routes without path parameters omit the `params` input, and routes with no
 * required request inputs may be called without an argument.
 *
 * @remarks
 * The method signatures are inferred from the `App`'s accumulated route tuple.
 * Chain registrations or compose independently exported contracts with
 * `app.registerRoutes([...])`, and avoid widening the result to a bare `App`
 * annotation because that deliberately discards the per-route tuple.
 *
 * @example
 * ```ts
 * import { createClient } from "@daloyjs/core/client";
 *
 * const app = new App().route({
 *   method: "GET",
 *   path: "/books/:id",
 *   operationId: "getBook",
 *   request: { params: z.object({ id: z.string() }) },
 *   responses: { 200: { description: "OK", body: z.object({ id: z.string(), title: z.string() }) } },
 *   handler: ({ params }) => ({ status: 200, body: { id: params.id, title: "Dune" } }),
 * });
 *
 * const client = createClient(app, { baseUrl: "https://api.example.com" });
 * const res = await client.getBook({ params: { id: "123" } });
 * if (res.status === 200) console.log(res.body.title);
 * ```
 *
 * @param app - The `App` instance whose routes drive the client surface.
 * @param opts - `baseUrl`, optional custom `fetch`, and default `headers`.
 * @returns A typed client object keyed by `operationId`.
 * @throws TypeError (from a generated method, before any request is sent) when
 * a path param is missing, empty, or `.` / `..`. Params are substituted by
 * whole segment; `*name` wildcards accept `/`-separated values, each segment
 * encoded and checked the same way. Dot segments are refused because URL
 * parsing would resolve them (even as `%2E%2E`) and retarget another route.
 * @since 0.1.0
 */
export function createClient<A extends App>(app: A, opts: ClientOptions): ClientFor<A> {
  const f = opts.fetch ?? fetch;
  const out: Record<string, unknown> = {};

  for (const route of app.routes) {
    if (!route.operationId) continue;
    const template = compilePathTemplate(route.path as string);
    out[route.operationId] = async (input: any = {}) => {
      const path = buildPath(template, route.path as string, input.params);
      const url = new URL(path, opts.baseUrl);
      if (input.query) {
        for (const [k, v] of Object.entries(input.query)) {
          if (v === undefined) continue;
          if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
          else url.searchParams.set(k, String(v));
        }
      }
      const headers: Record<string, string> = { ...opts.headers, ...input.headers };
      let body: BodyInit | undefined;
      if (input.body !== undefined) {
        headers["content-type"] ??= "application/json";
        body = JSON.stringify(input.body);
      }
      const res = await f(url.toString(), { method: route.method, headers, body });
      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      const headersOut: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headersOut[k] = v;
      });
      return { status: res.status, body: parsed, headers: headersOut } as any;
    };
  }

  return out as ClientFor<A>;
}

/**
 * Build a typed client that dispatches directly through an App without
 * opening a socket or binding a port.
 *
 * Requests still traverse the complete validation, middleware, security, and
 * serialization pipeline through {@link "./app.js".App.fetch}.
 * Routes without path parameters omit the `params` input, and routes with no
 * required request inputs may be called without an argument.
 *
 * @param app - App whose registered route tuple drives the client surface.
 * @param opts - Optional synthetic origin and default request headers.
 * @returns A typed operation-id client backed by in-process dispatch.
 * @since 1.0.0
 */
export function createInProcessClient<A extends App>(
  app: A,
  opts: InProcessClientOptions = {}
): ClientFor<A> {
  const clientOptions: ClientOptions = {
    baseUrl: opts.baseUrl ?? "http://daloy.local",
    fetch: (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      return app.fetch(request);
    },
  };
  if (opts.headers) clientOptions.headers = opts.headers;
  return createClient(app, clientOptions);
}

/**
 * A route path pre-split into literal segments and capture slots. Strings are
 * emitted verbatim; `{ name, wildcard }` entries are filled from `params`.
 */
type PathTemplate = ReadonlyArray<string | { name: string; wildcard: boolean }>;

/** Split a route path once, at client construction, into a {@link PathTemplate}. */
function compilePathTemplate(path: string): PathTemplate {
  return path.split("/").map((seg) => {
    if (seg.startsWith(":")) return { name: seg.slice(1), wildcard: false };
    if (seg.startsWith("*")) {
      return { name: seg.length > 1 ? seg.slice(1) : "wildcard", wildcard: true };
    }
    return seg;
  });
}

/**
 * Fill a {@link PathTemplate} from `params`, substituting by whole segment so a
 * `:id` capture can never match inside `:idx`.
 *
 * Security: each value is percent-encoded into its own segment. Empty values
 * and `.` / `..` values are refused, because WHATWG URL parsing resolves `..`
 * (and `%2E%2E`, `.%2E`, ...) as a parent-directory step, which would silently
 * retarget the request at a different route (e.g. `DELETE /orgs/:org/members/..`
 * becoming `DELETE /orgs/:org`). Wildcard values may span several `/`-separated
 * segments; every one of them is checked the same way.
 *
 * @throws TypeError when a capture is missing, empty, or a dot segment.
 */
function buildPath(template: PathTemplate, routePath: string, params: any): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const part = template[i]!;
    if (i > 0) out += "/";
    if (typeof part === "string") {
      out += part;
      continue;
    }
    const raw = params == null ? undefined : params[part.name];
    if (raw === undefined || raw === null) {
      throw new TypeError(`Missing path parameter "${part.name}" for ${routePath}`);
    }
    const value = String(raw);
    if (!part.wildcard) {
      out += encodeSegment(value, part.name, routePath);
      continue;
    }
    const pieces = value.split("/");
    for (let j = 0; j < pieces.length; j++) {
      if (j > 0) out += "/";
      out += encodeSegment(pieces[j]!, part.name, routePath);
    }
  }
  return out;
}

/** Encode one path segment, refusing empty and `.` / `..` values. */
function encodeSegment(value: string, name: string, routePath: string): string {
  if (value === "" || value === "." || value === "..") {
    throw new TypeError(
      `Invalid path parameter "${name}" for ${routePath}: empty and "."/".." segments are not allowed`,
    );
  }
  return encodeURIComponent(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
