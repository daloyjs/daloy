import type { StandardSchemaV1 } from "./schema.js";

/** HTTP methods supported by DaloyJS. */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** A path string, e.g. "/books/:id". */
export type PathString = `/${string}`;

/** Extract path-parameter names from a route path. */
export type ParamsOf<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ParamsOf<`/${Rest}`>
    : P extends `${string}:${infer Param}`
    ? Param
    : never;

/** Map of path params with all string values (raw). */
export type PathParams<P extends string> = {
  [K in ParamsOf<P>]: string;
};

// ---------- Request schema bag ----------

export interface RequestSchemas {
  params?: StandardSchemaV1;
  query?: StandardSchemaV1;
  headers?: StandardSchemaV1;
  body?: StandardSchemaV1;
}

export type InferOut<S> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S>
  : undefined;

export type InferRequest<R extends RequestSchemas | undefined, P extends string> = {
  params: R extends { params: StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<R["params"]>
    : PathParams<P>;
  query: R extends { query: StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<R["query"]>
    : Record<string, string | string[] | undefined>;
  headers: R extends { headers: StandardSchemaV1 }
    ? StandardSchemaV1.InferOutput<R["headers"]>
    : Record<string, string | undefined>;
  body: R extends { body: StandardSchemaV1 } ? InferOut<R["body"]> : unknown;
};

// ---------- Responses ----------

export interface ResponseSpec {
  description: string;
  body?: StandardSchemaV1;
  headers?: Record<string, { description?: string; schema?: StandardSchemaV1 }>;
  examples?: Record<string, unknown>;
}

export type ResponsesMap = {
  [Status in number]?: ResponseSpec;
};

export type StatusOf<R extends ResponsesMap> = Extract<keyof R, number>;

export type HandlerReturn<R extends ResponsesMap> = {
  [S in StatusOf<R>]: {
    status: S;
    body: R[S] extends { body: StandardSchemaV1 }
      ? StandardSchemaV1.InferInput<NonNullable<R[S]>["body"] & StandardSchemaV1>
      : unknown;
    headers?: Record<string, string>;
  };
}[StatusOf<R>];

// ---------- Auth ----------

export interface AuthSpec {
  /** Name referenced in OpenAPI components.securitySchemes */
  scheme: string;
  /** Optional scopes/permissions, surfaces in OpenAPI security requirement */
  scopes?: string[];
}

// ---------- Context ----------

/**
 * Augment this interface from application code to type plugin-provided state.
 */
export interface AppState {}

export interface BaseContext<P extends string, R extends RequestSchemas | undefined> {
  request: Request;
  /** Validated request data (or raw fallbacks if no schema). */
  params: InferRequest<R, P>["params"];
  query: InferRequest<R, P>["query"];
  headers: InferRequest<R, P>["headers"];
  body: InferRequest<R, P>["body"];
  /** Mutable per-request state. Plugin-augmented context lives here. */
  state: AppState & Record<string, unknown>;
  /** Convenience response helpers (do not bypass schema validation). */
  set: {
    status?: number;
    headers: Headers;
  };
}

// ---------- Hooks ----------

export interface Hooks {
  onRequest?: (req: Request) => void | Promise<void>;
  beforeHandle?: (ctx: BaseContext<any, any>) => void | Response | Promise<void | Response>;
  afterHandle?: (
    ctx: BaseContext<any, any>,
    result: unknown
  ) => void | unknown | Promise<void | unknown>;
  onError?: (err: unknown, ctx: BaseContext<any, any> | undefined) => void | Response | Promise<void | Response>;
  onResponse?: (res: Response) => void | Promise<void>;
}

// ---------- Route definition ----------

export interface RouteDefinition<
  P extends PathString = PathString,
  M extends HttpMethod = HttpMethod,
  Req extends RequestSchemas | undefined = undefined,
  Res extends ResponsesMap = ResponsesMap
> {
  method: M;
  path: P;

  // OpenAPI / introspection metadata
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  version?: string;

  request?: Req;
  responses: Res;

  auth?: AuthSpec;

  hooks?: Hooks;

  handler: (
    ctx: BaseContext<P, Req>
  ) => HandlerReturn<Res> | Promise<HandlerReturn<Res>>;
}
