import { Router } from "./router.js";
import {
  BadRequestError,
  HttpError,
  InternalError,
  MethodNotAllowedError,
  NotFoundError,
  PayloadTooLargeError,
  RequestTimeoutError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "./errors.js";
import { validate } from "./schema.js";
import { readBodyLimited, safeJsonParse, randomId } from "./security.js";
import { createLogger, noopLogger, type Logger } from "./logger.js";
import type {
  BaseContext,
  HttpMethod,
  Hooks,
  PathString,
  RequestSchemas,
  ResponsesMap,
  RouteDefinition,
} from "./types.js";

export interface AppOptions {
  /** OpenAPI document metadata */
  title?: string;
  version?: string;
  description?: string;

  /** Validate handler responses against declared response schemas. Default: true. */
  validateResponses?: boolean;

  /** Hard cap on request body size in bytes. Default: 1 MiB. */
  bodyLimitBytes?: number;

  /** Reject requests whose Content-Type isn't in this allowlist (when a body schema is declared). */
  allowedContentTypes?: string[];

  /** Per-request timeout in ms (handler + hooks). Default: 30000. Set 0 to disable. */
  requestTimeoutMs?: number;

  /**
   * Per-request limits applied when parsing `multipart/form-data` bodies.
   * These run in addition to `bodyLimitBytes`. Use them to cap the size of
   * any single uploaded file, the total number of fields, and the total
   * number of file uploads accepted in one request.
   */
  multipart?: {
    /** Reject any single file whose `size` exceeds this many bytes. */
    maxFileBytes?: number;
    /** Reject the request if it carries more than this many fields total. */
    maxFields?: number;
    /** Reject the request if it carries more than this many file uploads. */
    maxFiles?: number;
  };

  /** Production mode hides 5xx detail in error responses. Default: NODE_ENV === "production". */
  production?: boolean;
  /** Pluggable logger. Default: structured JSON logger at "info" (or noop in test). */
  logger?: Logger | { level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" } | false;

  /**
   * Mock mode: instead of running handlers, return the first declared response example
   * (or an empty body matching the schema). Useful for frontend teams.
   */
  mockMode?: boolean;

  /** Global hooks applied to every route. */
  hooks?: Hooks;
}

/** Information passed to {@link App.onPluginInstalled} listeners. */
export interface PluginInstalledEvent {
  /** Name of the plugin (only set when registered with `{ name, register }`). */
  name?: string;
  /** Effective mount prefix after parent/group prefixes are applied. */
  prefix: string;
}

/** Information passed to {@link App.onShutdown} listeners. */
export interface ShutdownEvent {
  /** Optional human-readable reason supplied to `app.shutdown(_, reason)`. */
  reason?: string;
  /** Drain timeout (ms) the shutdown will use after listeners finish. */
  timeoutMs: number;
}

export interface IntrospectedRoute {
  method: HttpMethod;
  path: string;
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  hasBody: boolean;
  hasQuery: boolean;
  hasParams: boolean;
  hasHeaders: boolean;
  responses: number[];
  auth?: { scheme: string; scopes?: string[] };
}

interface CompiledRoute {
  def: RouteDefinition<any, any, any, any>;
  hooks: Hooks;
}

const DEFAULTS = {
  bodyLimitBytes: 1024 * 1024,
  requestTimeoutMs: 30_000,
  validateResponses: true,
};

export class App {
  readonly options: Required<Pick<AppOptions, "validateResponses" | "bodyLimitBytes" | "requestTimeoutMs">> &
    AppOptions;
  readonly log: Logger;
  /** Public registry: enables OpenAPI gen, typed-client gen, dead-route detection. */
  readonly routes: RouteDefinition<any, any, any, any>[] = [];

  private router = new Router<CompiledRoute>();
  private prefix = "";
  private groupHooks: Hooks[] = [];
  private groupTags: string[] = [];
  private groupAuth?: RouteDefinition["auth"];
  /** Decorator bag merged into ctx.state on every request. */
  private decorations: Record<string, unknown> = {};
  private installedPlugins = new Set<string>();
  private closeHooks: Array<() => void | Promise<void>> = [];
  private closeHooksRun = false;
  private pluginInstalledListeners: Array<(info: PluginInstalledEvent) => void | Promise<void>> = [];
  private shutdownListeners: Array<(info: ShutdownEvent) => void | Promise<void>> = [];
  private shutdownListenersRun = false;
  private pendingPlugins: Promise<unknown>[] = [];
  /** In-flight request count for graceful shutdown. */
  private inflight = 0;
  private draining = false;

  constructor(options: AppOptions = {}) {
    this.options = {
      validateResponses: options.validateResponses ?? DEFAULTS.validateResponses,
      bodyLimitBytes: options.bodyLimitBytes ?? DEFAULTS.bodyLimitBytes,
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
      ...options,
    };
    this.log =
      options.logger === false
        ? noopLogger
        : options.logger && typeof (options.logger as Logger).info === "function"
        ? (options.logger as Logger)
        : createLogger({ level: (options.logger as any)?.level ?? "info" });
  }

  // ---------- registration ----------

  route<
    P extends PathString,
    M extends HttpMethod,
    Req extends RequestSchemas | undefined,
    Res extends ResponsesMap
  >(def: RouteDefinition<P, M, Req, Res>): this {
    const fullPath = joinPath(this.prefix, def.path) as PathString;
    const merged: RouteDefinition<any, any, any, any> = {
      ...def,
      path: fullPath,
      tags: [...(this.groupTags ?? []), ...(def.tags ?? [])],
      auth: def.auth ?? this.groupAuth,
    };
    const hooks = mergeHooks([...this.groupHooks, def.hooks ?? {}]);
    this.router.add(def.method, fullPath, { def: merged, hooks }, def.operationId);
    this.routes.push(merged);
    return this;
  }

  /** Group routes under a path prefix with shared tags/hooks/auth (encapsulated). */
  group(
    prefix: PathString,
    config: { tags?: string[]; hooks?: Hooks; auth?: RouteDefinition["auth"] },
    register: (app: App) => void
  ): this {
    const child = new App(this.options);
    (child as any).router = this.router;
    (child as any).routes = this.routes;
    (child as any).log = this.log;
    (child as any).prefix = joinPath(this.prefix, prefix);
    (child as any).groupHooks = [...this.groupHooks, ...(config.hooks ? [config.hooks] : [])];
    (child as any).groupTags = [...this.groupTags, ...(config.tags ?? [])];
    (child as any).groupAuth = config.auth ?? this.groupAuth;
    (child as any).decorations = this.decorations;
    (child as any).installedPlugins = this.installedPlugins;
    (child as any).closeHooks = this.closeHooks;
    (child as any).pluginInstalledListeners = this.pluginInstalledListeners;
    (child as any).shutdownListeners = this.shutdownListeners;
    (child as any).pendingPlugins = this.pendingPlugins;
    register(child);
    return this;
  }

  /** Attach a hook layer to all subsequently-registered routes. */
  use(hooks: Hooks): this {
    this.groupHooks.push(hooks);
    return this;
  }

  /** Decorate ctx.state with values available in every handler. */
  decorate<K extends string, V>(key: K, value: V): this {
    this.decorations[key] = value;
    return this;
  }

  /** Register cleanup to run once during graceful shutdown. */
  onClose(hook: () => void | Promise<void>): this {
    this.closeHooks.push(hook);
    return this;
  }

  /**
    * Subscribe to plugin install events. The listener fires once per registered
   * plugin, after `register()` (or its returned promise) completes. Useful
   * for observability plugins that want to enumerate everything else that
   * was installed without polluting the route registry.
   */
  onPluginInstalled(listener: (info: PluginInstalledEvent) => void | Promise<void>): this {
    this.pluginInstalledListeners.push(listener);
    return this;
  }

  /**
   * Subscribe to the start of graceful shutdown. Listeners run before
   * in-flight requests drain so observability plugins can flush metrics or
   * publish a "draining" signal to load balancers. Use `onClose()` for
   * post-drain cleanup such as closing pools.
   */
  onShutdown(listener: (info: ShutdownEvent) => void | Promise<void>): this {
    this.shutdownListeners.push(listener);
    return this;
  }

  /**
   * Encapsulated plugin registration (Fastify-style).
   * The plugin function receives a child App; its routes/hooks are scoped.
   */
  register(
    plugin: { name?: string; register: (app: App) => void | Promise<void> } | ((app: App) => void | Promise<void>),
    config: { prefix?: PathString; tags?: string[]; hooks?: Hooks; auth?: RouteDefinition["auth"] } = {}
  ): this {
    const fn = typeof plugin === "function" ? plugin : plugin.register;
    const name = typeof plugin === "function" ? undefined : plugin.name;
    if (name) {
      if (this.installedPlugins.has(name)) {
        throw new Error(`Plugin "${name}" already registered`);
      }
      this.installedPlugins.add(name);
    }
    const prefix = config.prefix ?? ("/" as PathString);
    const event: PluginInstalledEvent = { name, prefix: joinPath(this.prefix, prefix) };
    this.group(prefix, config, (child) => {
      const r = fn(child);
      if (r && typeof (r as Promise<unknown>).then === "function") {
        // Plugin is async — caller should await app.ready().
        this.pendingPlugins.push((r as Promise<unknown>).then(() => this.firePluginInstalled(event)));
      } else {
        // Sync plugin: fire listeners immediately. Any returned promise from a
        // listener is collected so `app.ready()` can await observers too.
        const pending = this.firePluginInstalled(event);
        if (pending) {
          this.pendingPlugins.push(pending);
        }
      }
    });
    return this;
  }

  private firePluginInstalled(event: PluginInstalledEvent): Promise<void> | undefined {
    if (this.pluginInstalledListeners.length === 0) return undefined;
    const promises: Array<Promise<unknown>> = [];
    for (const listener of this.pluginInstalledListeners) {
      try {
        const r = listener(event);
        if (r && typeof (r as Promise<unknown>).then === "function") {
          promises.push((r as Promise<unknown>).catch((err) => {
            this.log.error({ err, plugin: event.name }, "onPluginInstalled listener failed");
          }));
        }
      } catch (err) {
        this.log.error({ err, plugin: event.name }, "onPluginInstalled listener failed");
      }
    }
    return promises.length > 0 ? Promise.all(promises).then(() => undefined) : undefined;
  }

  /** Wait for all async plugins to finish initializing. */
  ready(): Promise<void> {
    if (this.pendingPlugins.length === 0) return Promise.resolve();
    const pending = this.pendingPlugins.splice(0);
    return Promise.all(pending).then(() => undefined);
  }
  fetch = async (request: Request): Promise<Response> => {
    if (this.draining) {
      return new Response(
        JSON.stringify({
          type: "https://daloyjs.dev/errors/shutting-down",
          title: "Service Unavailable",
          status: 503,
        }),
        { status: 503, headers: { "content-type": "application/problem+json", "retry-after": "5" } }
      );
    }
    this.inflight++;
    const requestId = randomId();
    const log = this.log.child({ requestId, method: request.method, url: request.url });
    let ctx: BaseContext<any, any> | undefined;
    const globalHooks = mergeHooks([this.options.hooks ?? {}]);
    let activeErrorHook = globalHooks.onError;
    let activeResponseHook = globalHooks.onResponse;
    let activeSendHook = globalHooks.onSend;

    try {
      await globalHooks.onRequest?.(request);

      const url = new URL(request.url);
      const method = request.method as HttpMethod;
      const headFallback = method === "HEAD";
      const match = this.router.find(method, url.pathname) ?? (headFallback ? this.router.find("GET", url.pathname) : undefined);

      if (!match) {
        const allowed = this.router.allowedMethods(url.pathname);
        ctx = {
          request,
          params: {},
          query: Object.fromEntries(url.searchParams.entries()),
          headers: headersToObject(request.headers),
          body: undefined,
          state: { ...this.decorations, requestId, log },
          set: { headers: new Headers() },
        };
        ctx.set.headers.set("x-request-id", requestId);
        if (allowed.length > 0) {
          if (method === "OPTIONS") {
            // Synthesize a preflight: let global hooks (e.g. CORS) intercept;
            // otherwise return 204 with Allow header.
            const synthCtx: BaseContext<any, any> = {
              request,
              params: {},
              query: {},
              headers: headersToObject(request.headers),
              body: undefined,
              state: { ...this.decorations, requestId, log },
              set: { headers: new Headers() },
            };
            const preflightHooks = mergeHooks([this.options.hooks ?? {}, ...this.groupHooks]);
            const intercepted = await preflightHooks.beforeHandle?.(synthCtx);
            if (intercepted instanceof Response) {
              copyContextHeaders(synthCtx, intercepted);
              return await finalizeResponse(intercepted, synthCtx, preflightHooks);
            }
            const res = new Response(null, { status: 204, headers: { allow: allowed.join(", ") } });
            copyContextHeaders(synthCtx, res);
            res.headers.set("x-request-id", requestId);
            return await finalizeResponse(res, synthCtx, preflightHooks);
          }
          throw new MethodNotAllowedError(allowed);
        }
        throw new NotFoundError(`No route for ${request.method} ${url.pathname}`);
      }

      const { def, hooks } = match.handler;
      const allHooks = mergeHooks([globalHooks, hooks]);
      activeErrorHook = allHooks.onError;
      activeResponseHook = allHooks.onResponse;
      activeSendHook = allHooks.onSend;

      await hooks.onRequest?.(request);

      ctx = await buildContext(request, url, match.params, def, this.options);
      Object.assign(ctx.state, this.decorations, { requestId, log });
      ctx.set.headers.set("x-request-id", requestId);

      const before = await allHooks.beforeHandle?.(ctx);
      if (before instanceof Response) {
        copyContextHeaders(ctx, before);
        return await finalizeResponse(before, ctx, allHooks);
      }

      let result: any = this.options.mockMode
        ? mockResponseFor(def)
        : await runHandler(def, ctx, this.options.requestTimeoutMs);
      const afterReturn = await allHooks.afterHandle?.(ctx, result);
      if (afterReturn !== undefined) result = afterReturn;

      let response = await serializeResult(result, def, this.options.validateResponses ?? true);
      if (method === "HEAD") {
        response = new Response(null, { status: response.status, headers: response.headers });
      }
      copyContextHeaders(ctx, response);
      return await finalizeResponse(response, ctx, allHooks);
    } catch (err) {
      const handled = await activeErrorHook?.(err, ctx);
      if (handled instanceof Response) {
        if (ctx) copyContextHeaders(ctx, handled);
        if (!handled.headers.has("x-request-id")) handled.headers.set("x-request-id", requestId);
        return finalizeResponse(handled, ctx, { onSend: activeSendHook, onResponse: activeResponseHook });
      }
      const httpErr: HttpError =
        err instanceof HttpError
          ? err
          : new InternalError(err instanceof Error ? err.message : "Unexpected error");
      if (httpErr.status >= 500) log.error({ err: serializeErr(err) }, httpErr.problem.title);
      if (httpErr.status < 500) log.warn({ status: httpErr.status }, httpErr.problem.title);
      const res = httpErr.toResponse({
        production: this.options.production,
        requestId,
      });
      if (ctx) copyContextHeaders(ctx, res);
      if (!res.headers.has("x-request-id")) res.headers.set("x-request-id", requestId);
      return finalizeResponse(res, ctx, { onSend: activeSendHook, onResponse: activeResponseHook });
    } finally {
      this.inflight--;
    }
  };

  /** In-process test client. */
  request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url =
      typeof input === "string" && input.startsWith("/") ? `http://test.local${input}` : input;
    const req = url instanceof Request ? url : new Request(url as any, init);
    return this.fetch(req);
  }

  introspect(): IntrospectedRoute[] {
    return this.routes.map((r) => {
      const route: IntrospectedRoute = {
        method: r.method,
        path: r.path,
        hasBody: hasRequestSchema(r.request, "body"),
        hasQuery: hasRequestSchema(r.request, "query"),
        hasParams: hasRequestSchema(r.request, "params"),
        hasHeaders: hasRequestSchema(r.request, "headers"),
        responses: Object.keys(r.responses).map(Number),
      };
      if (r.operationId !== undefined) route.operationId = r.operationId;
      if (r.tags !== undefined) route.tags = r.tags;
      if (r.summary !== undefined) route.summary = r.summary;
      if (r.description !== undefined) route.description = r.description;
      if (r.deprecated !== undefined) route.deprecated = r.deprecated;
      if (r.auth !== undefined) route.auth = r.auth;
      return route;
    });
  }

  /**
   * Begin graceful shutdown: stop accepting new requests, wait for in-flight
   * requests to drain (up to `timeoutMs`).
   */
  async shutdown(timeoutMs = 10_000, reason?: string): Promise<void> {
    this.draining = true;
    if (!this.shutdownListenersRun) {
      this.shutdownListenersRun = true;
      const event: ShutdownEvent = { reason, timeoutMs };
      for (const listener of this.shutdownListeners) {
        try {
          await listener(event);
        } catch (err) {
          this.log.error({ err }, "onShutdown listener failed");
        }
      }
    }
    const start = Date.now();
    while (this.inflight > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!this.closeHooksRun) {
      this.closeHooksRun = true;
      for (const hook of this.closeHooks) {
        await hook();
      }
    }
    this.log.info({ inflight: this.inflight }, "DaloyJS shutdown complete");
  }
}

// ---------- helpers ----------

function joinPath(a: string, b: string): string {
  const left = a.replace(/\/+$/, "");
  const right = b.startsWith("/") ? b : `/${b}`;
  const joined = `${left}${right}`;
  return joined === "" ? "/" : joined;
}

function mergeHooks(layers: Hooks[]): Hooks {
  const pick = <K extends keyof Hooks>(key: K): NonNullable<Hooks[K]>[] =>
    layers
      .map((h) => h[key])
      .filter((f): f is NonNullable<Hooks[K]> => typeof f === "function");
  return {
    onRequest: chain(pick("onRequest")),
    beforeHandle: firstResponse(pick("beforeHandle")),
    afterHandle: pipeline(pick("afterHandle")),
    onError: firstResponse(pick("onError")),
    onSend: responsePipeline(pick("onSend")),
    onResponse: chain(pick("onResponse")),
  };
}

function responsePipeline(
  fns: NonNullable<Hooks["onSend"]>[]
): NonNullable<Hooks["onSend"]> | undefined {
  if (fns.length === 0) return undefined;
  return async (res, ctx) => {
    let current = res;
    for (const fn of fns) {
      const r = await fn(current, ctx);
      if (r instanceof Response) current = r;
    }
    return current;
  };
}

async function finalizeResponse(
  res: Response,
  ctx: BaseContext<any, any> | undefined,
  hooks: Pick<Hooks, "onSend" | "onResponse">
): Promise<Response> {
  const sent = await hooks.onSend?.(res, ctx);
  const final = sent instanceof Response ? sent : res;
  await hooks.onResponse?.(final);
  return final;
}

function chain<F extends (...args: any[]) => any>(fns: F[]): F | undefined {
  if (fns.length === 0) return undefined;
  return (async (...args: any[]) => {
    for (const fn of fns) await fn(...args);
  }) as unknown as F;
}

function firstResponse<F extends (...args: any[]) => any>(fns: F[]): F | undefined {
  if (fns.length === 0) return undefined;
  return (async (...args: any[]) => {
    for (const fn of fns) {
      const r = await fn(...args);
      if (r instanceof Response) return r;
    }
    return undefined;
  }) as unknown as F;
}

function pipeline<F extends (ctx: any, value: any) => any>(fns: F[]): F | undefined {
  if (fns.length === 0) return undefined;
  return (async (ctx: any, value: any) => {
    let v = value;
    for (const fn of fns) {
      const r = await fn(ctx, v);
      if (r !== undefined) v = r;
    }
    return v;
  }) as unknown as F;
}

function copyContextHeaders(ctx: BaseContext<any, any>, res: Response): void {
  ctx.set.headers.forEach((v, k) => {
    if (!res.headers.has(k)) res.headers.set(k, v);
  });
}

function hasRequestSchema(
  request: RequestSchemas | undefined,
  key: keyof RequestSchemas
): boolean {
  return !!request && !!request[key];
}

async function buildContext(
  request: Request,
  url: URL,
  rawParams: Record<string, string>,
  def: RouteDefinition<any, any, any, any>,
  opts: {
    bodyLimitBytes: number;
    allowedContentTypes?: string[];
    multipart?: AppOptions["multipart"];
  }
): Promise<BaseContext<any, any>> {
  const set = { headers: new Headers() };
  const headersObj = headersToObject(request.headers);
  const queryObj = queryToObject(url.searchParams);

  let params: any = rawParams;
  let query: any = queryObj;
  let headers: any = headersObj;
  let body: any = undefined;

  if (def.request?.params) {
    const r = await validate(def.request.params, rawParams);
    if (r.issues) throw new ValidationError("params", toIssues(r.issues));
    params = r.value;
  }
  if (def.request?.query) {
    const r = await validate(def.request.query, queryObj);
    if (r.issues) throw new ValidationError("query", toIssues(r.issues));
    query = r.value;
  }
  if (def.request?.headers) {
    const r = await validate(def.request.headers, headersObj);
    if (r.issues) throw new ValidationError("headers", toIssues(r.issues));
    headers = r.value;
  }
  if (def.request?.body) {
    const ct = (request.headers.get("content-type") ?? "").toLowerCase();
    const allowed = opts.allowedContentTypes ?? [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ];
    if (!allowed.some((a) => ct.includes(a))) {
      throw new UnsupportedMediaTypeError(ct || "(none)", allowed);
    }
    const raw = await readBody(request, ct, opts.bodyLimitBytes, opts.multipart);
    const r = await validate(def.request.body, raw);
    if (r.issues) throw new ValidationError("body", toIssues(r.issues));
    body = r.value;
  }

  return { request, params, query, headers, body, state: {}, set };
}

function headersToObject(h: Headers): Record<string, string> {
  const o: Record<string, string> = {};
  h.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

function queryToObject(s: URLSearchParams): Record<string, string | string[]> {
  const o: Record<string, string | string[]> = {};
  for (const key of new Set(s.keys())) {
    const all = s.getAll(key);
    o[key] = all.length > 1 ? all : (all[0] as string);
  }
  return o;
}

function toIssues(issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<any> }>) {
  return issues.map((i) => ({
    message: i.message,
    path: (i.path ?? [])
      .map((p) => (typeof p === "object" && p && "key" in p ? (p as any).key : p))
      .join("."),
  }));
}

async function readBody(
  req: Request,
  ct: string,
  limit: number,
  multipart?: AppOptions["multipart"]
): Promise<unknown> {
  if (ct.includes("application/json")) {
    const bytes = await readBodyLimited(req, limit);
    if (bytes.byteLength === 0) return undefined;
    return safeJsonParse(new TextDecoder().decode(bytes));
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const bytes = await readBodyLimited(req, limit);
    return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)));
  }
  if (ct.includes("multipart/form-data")) {
    // Multipart: rely on platform parser, but enforce content-length first.
    const cl = req.headers.get("content-length");
    if (cl && Number(cl) > limit) {
      throw new PayloadTooLargeError(limit);
    }
    const fd = await req.formData();
    const out: Record<string, unknown> = {};
    let fields = 0;
    let files = 0;
    (fd as any).forEach((v: unknown, k: string) => {
      fields++;
      const isFile =
        v != null &&
        typeof v === "object" &&
        typeof (v as Blob).size === "number" &&
        typeof (v as Blob).arrayBuffer === "function";
      if (isFile) {
        files++;
        if (
          multipart?.maxFileBytes !== undefined &&
          (v as Blob).size > multipart.maxFileBytes
        ) {
          throw new PayloadTooLargeError(multipart.maxFileBytes);
        }
      }
      out[k] = v;
    });
    if (multipart?.maxFields !== undefined && fields > multipart.maxFields) {
      throw new BadRequestError(
        `Too many form fields (${fields} > ${multipart.maxFields})`
      );
    }
    if (multipart?.maxFiles !== undefined && files > multipart.maxFiles) {
      throw new BadRequestError(
        `Too many file uploads (${files} > ${multipart.maxFiles})`
      );
    }
    return out;
  }
  const bytes = await readBodyLimited(req, limit);
  return new TextDecoder().decode(bytes);
}

async function serializeResult(
  result: { status: number; body: unknown; headers?: Record<string, string> },
  def: RouteDefinition<any, any, any, any>,
  validateResponses: boolean
): Promise<Response> {
  const spec = def.responses[result.status];
  if (!spec) {
    throw new InternalError(
      `Handler returned status ${result.status} which is not declared in responses for ${def.method} ${def.path}`
    );
  }
  if (validateResponses && spec.body) {
    const r = await validate(spec.body, result.body);
    if (r.issues) {
      throw new InternalError(
        `Response body for ${def.method} ${def.path} failed schema validation: ${
          r.issues.map((i) => i.message).join("; ")
        }`
      );
    }
  }
  const headers = new Headers(result.headers);
  const explicitCt = headers.get("content-type");
  const treatAsJson = !explicitCt || explicitCt.includes("application/json");
  if (!explicitCt) headers.set("content-type", "application/json");

  let body: BodyInit | null;
  if (result.body === undefined || result.body === null) {
    body = null;
  } else if (!treatAsJson && (typeof result.body === "string" || result.body instanceof Uint8Array || result.body instanceof ArrayBuffer)) {
    body = result.body as BodyInit;
  } else if (!treatAsJson && (result.body as any) instanceof ReadableStream) {
    body = result.body as BodyInit;
  } else {
    body = JSON.stringify(result.body);
  }
  return new Response(body, { status: result.status, headers });
}

function mockResponseFor(def: RouteDefinition<any, any, any, any>) {
  const statuses = Object.keys(def.responses).map(Number).sort();
  const status = statuses.find((s) => s >= 200 && s < 300) ?? statuses[0];
  if (status === undefined) throw new InternalError("Mock mode: no responses declared");
  const spec = def.responses[status]!;
  const example =
    spec.examples && Object.values(spec.examples)[0] !== undefined
      ? Object.values(spec.examples)[0]
      : null;
  return { status, body: example };
}

function runHandler(
  def: RouteDefinition<any, any, any, any>,
  ctx: BaseContext<any, any>,
  requestTimeoutMs: number
): Promise<unknown> {
  const handlerPromise = Promise.resolve(def.handler(ctx));
  return requestTimeoutMs > 0
    ? withTimeout(handlerPromise, requestTimeoutMs)
    : handlerPromise;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RequestTimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}
