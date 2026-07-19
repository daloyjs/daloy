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
 * the route's request and response schemas.
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
  : { params: InferRequest<Req, P>["params"] }) & {
  query?: Partial<InferRequest<Req, P>["query"]>;
  headers?: Record<string, string>;
} & (Req extends { body: infer _B }
    ? { body: InferRequest<Req, P>["body"] }
    : { body?: undefined });

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
 * @since 0.1.0
 */
export function createClient<A extends App>(app: A, opts: ClientOptions): ClientFor<A> {
  const f = opts.fetch ?? fetch;
  const out: Record<string, unknown> = {};

  for (const route of app.routes) {
    if (!route.operationId) continue;
    out[route.operationId] = async (input: any = {}) => {
      let path = route.path as string;
      const params = input.params ?? {};
      for (const [k, v] of Object.entries(params)) {
        path = path.replace(`:${k}`, encodeURIComponent(String(v)));
      }
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

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
