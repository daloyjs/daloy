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
  RequestSchemas,
  ResponsesMap,
  RouteDefinition,
} from "./types.js";

// Map an `App` to a record of routes keyed by operationId.
export type RoutesOf<A extends App> = A["routes"][number];

export type ClientFor<A extends App> = {
  [R in Extract<RoutesOf<A>, { operationId: string }> as R["operationId"]]: ClientMethod<R>;
};

type ClientMethod<R> = R extends RouteDefinition<
  infer P,
  infer _M,
  infer Req,
  infer Res
>
  ? (input: ClientInput<P, Req>) => Promise<ClientOutput<Res>>
  : never;

type ClientInput<P extends string, Req extends RequestSchemas | undefined> = {
  params: InferRequest<Req, P>["params"];
  query?: Partial<InferRequest<Req, P>["query"]>;
  headers?: Record<string, string>;
} & (Req extends { body: infer _B } ? { body: InferRequest<Req, P>["body"] } : { body?: undefined });

type ClientOutput<Res extends ResponsesMap> = HandlerReturn<Res>;

export interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

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

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
