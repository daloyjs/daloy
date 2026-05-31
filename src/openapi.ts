/**
 * OpenAPI 3.1 document generator.
 *
 * Built-in (not a plugin afterthought) — that's the whole point.
 *
 * If a schema exposes a `toJSONSchema()` method (Zod 4, Valibot, etc.)
 * we use it. Otherwise we emit a permissive `{}` placeholder rather than
 * fail — codegen and docs still work, just with looser types for that field.
 */

import type { App } from "./app.js";
import type {
  AuthSpec,
  CallbackDefinition,
  CallbackMap,
  CallbackOperation,
  HttpMethod,
  RequestSchemas,
  ResponsesMap,
  RouteMeta,
  RouteDefinition,
} from "./types.js";
import type { StandardSchemaV1 } from "./schema.js";
import type { SecurityScheme } from "./security-schemes.js";
import { toOpenAPISecurityScheme } from "./security-schemes.js";
import { getFileFieldOptions, getMultipartShape } from "./multipart.js";

export {
  httpBearerScheme,
  httpBasicScheme,
  apiKeyScheme,
  oauth2Scheme,
  openIdConnectScheme,
} from "./security-schemes.js";
export type {
  ApiKeyLocation,
  ApiKeyScheme,
  ApiKeySchemeOptions,
  HttpBasicScheme,
  HttpBasicSchemeOptions,
  HttpBearerScheme,
  HttpBearerSchemeOptions,
  OAuth2AuthorizationCodeFlow,
  OAuth2ClientCredentialsFlow,
  OAuth2Flows,
  OAuth2ImplicitFlow,
  OAuth2PasswordFlow,
  OAuth2Scheme,
  OAuth2SchemeOptions,
  OpenIdConnectScheme,
  OpenIdConnectSchemeOptions,
  SecurityScheme,
} from "./security-schemes.js";

export { discriminator, discriminatedUnion } from "./discriminator.js";
export type {
  DiscriminatorObject,
  DiscriminatedUnion,
  DiscriminatedUnionOptions,
} from "./discriminator.js";

export type {
  CallbackDefinition,
  CallbackMap,
  CallbackOperation,
} from "./types.js";

/** OpenAPI [Info Object](https://spec.openapis.org/oas/v3.1.0#info-object) header fields. */
export interface OpenAPIInfo {
  /** Human-readable API title shown by Swagger UI / Scalar. */
  title: string;
  /** Semantic API version (independent of your package version). */
  version: string;
  /** Optional CommonMark long description rendered at the top of the docs. */
  description?: string;
}

/**
 * Map of named OpenAPI Security Scheme objects. Builders from
 * `./security-schemes.ts` (`httpBearerScheme`, `apiKeyScheme`, ...) return
 * values that fit here.
 */
export interface SecuritySchemeMap {
  [name: string]: SecurityScheme | Record<string, unknown>;
}

/**
 * Webhook definition for OpenAPI 3.1 top-level `webhooks`. Mirrors a
 * `RouteDefinition` minus `path` (consumers control the URL) and `handler`
 * (no execution path on the producer side).
 */
export interface WebhookDefinition {
  method: HttpMethod;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  request?: RequestSchemas;
  responses: ResponsesMap;
  auth?: AuthSpec;
  /**
   * Optional OpenAPI 3.1 callbacks attached to this webhook operation.
   * Same shape used by route-level `callbacks`.
   */
  callbacks?: CallbackMap;
}

/** Options for {@link generateOpenAPI}. */
export interface OpenAPIOptions {
  /** Required `info` block (title + version). */
  info: OpenAPIInfo;
  /** Optional list of servers exposed in the document. */
  servers?: Array<{ url: string; description?: string }>;
  /** Named security schemes referenced by route `auth` declarations. */
  securitySchemes?: SecuritySchemeMap;
  /**
   * Include routes marked `internal: true` in the generated document.
   * Defaults to `false` so public docs and SDKs do not leak in-process-only
   * admin, cron, or test endpoints.
   *
   * @since 0.19.0
   */
  includeInternal?: boolean;
  /**
   * Optional OpenAPI 3.1 webhooks. Each key is a webhook name; the value is
   * one or more webhook operations (one per HTTP method).
   */
  webhooks?: Record<string, WebhookDefinition | WebhookDefinition[]>;
}

/**
 * Generate an OpenAPI 3.1 document from a registered {@link App}.
 *
 * The output is a plain JSON-serializable object — hand it to Swagger UI,
 * write it to disk for client SDK generation (`@hey-api/openapi-ts`), or
 * serve it from a route. Every route registered on `app` becomes one
 * Operation Object; request/response schemas, callbacks, and the
 * `securitySchemes` you pass are stitched into the standard slots.
 *
 * Schemas implementing Standard Schema with an optional `toJSONSchema()`
 * method (Zod 4, Valibot, ArkType, ...) are converted to JSON Schema
 * automatically; otherwise a permissive `{}` is emitted.
 *
 * @example
 * ```ts
 * import { httpBearerScheme } from "@daloyjs/core";
 * import { generateOpenAPI } from "@daloyjs/core/openapi";
 * import { writeFileSync } from "node:fs";
 *
 * const doc = generateOpenAPI(app, {
 *   info: { title: "Books API", version: "1.0.0" },
 *   servers: [{ url: "https://api.example.com" }],
 *   securitySchemes: { bearerAuth: httpBearerScheme({ bearerFormat: "JWT" }) },
 * });
 * writeFileSync("./generated/openapi.json", JSON.stringify(doc, null, 2));
 * ```
 *
 * @param app - The application whose routes are documented.
 * @param options - Document metadata, servers, security schemes, and webhooks.
 * @returns A JSON-serializable OpenAPI 3.1 document.
 * @since 0.1.0
 */
export function generateOpenAPI(app: App, options: OpenAPIOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of app.routes) {
    if (route.internal === true && options.includeInternal !== true) continue;
    const oasPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    (paths[oasPath] ??= {})[route.method.toLowerCase()] = buildOperation(route, route.path);
  }

  const webhooks = buildWebhooks(options.webhooks);

  return {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
    ...(webhooks ? { webhooks } : {}),
    components: {
      ...(options.securitySchemes
        ? { securitySchemes: normalizeSecuritySchemes(options.securitySchemes) }
        : {}),
      schemas: {
        Problem: {
          type: "object",
          required: ["type", "title", "status"],
          properties: {
            type: { type: "string", format: "uri" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string" },
            errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}

function normalizeSecuritySchemes(
  schemes: SecuritySchemeMap | undefined,
): SecuritySchemeMap | undefined {
  if (!schemes) return undefined;
  const out: SecuritySchemeMap = {};
  for (const [name, scheme] of Object.entries(schemes)) {
    out[name] = toOpenAPISecurityScheme(scheme) as SecurityScheme | Record<string, unknown>;
  }
  return out;
}

type OperationLike =
  | RouteDefinition<any, any, any, any>
  | WebhookDefinition
  | CallbackOperation;

function buildOperation(
  route: OperationLike,
  path?: string
): Record<string, unknown> {
  const meta = (route as { meta?: RouteMeta }).meta;
  const mergedTags = mergeTags(route.tags, meta?.tags);
  const op: Record<string, unknown> = {
    ...(route.operationId ? { operationId: route.operationId } : {}),
    ...(route.summary ?? meta?.summary ? { summary: route.summary ?? meta?.summary } : {}),
    ...(route.description ?? meta?.description
      ? { description: route.description ?? meta?.description }
      : {}),
    ...(mergedTags.length ? { tags: mergedTags } : {}),
    ...(route.deprecated || (route as { sunset?: unknown }).sunset ? { deprecated: true } : {}),
    ...((route as { sunset?: unknown }).sunset
      ? { "x-sunset": (route as { sunset?: unknown }).sunset }
      : {}),
  };

  const parameters: Array<Record<string, unknown>> = [];

  if (path) {
    // Path params: emit one entry per :name in the path.
    const paramNames = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    for (const name of paramNames) {
      parameters.push({
        name,
        in: "path",
        required: true,
        schema: extractPropertySchema(route.request?.params, name) ?? { type: "string" },
      });
    }
  }

  if (route.request?.query) {
    const schema = toJsonSchema(route.request.query) ?? { type: "object" };
    const props = (schema as any).properties ?? {};
    const required: string[] = (schema as any).required ?? [];
    for (const [name, propSchema] of Object.entries(props)) {
      parameters.push({
        name,
        in: "query",
        required: required.includes(name),
        schema: propSchema,
      });
    }
  }

  if (parameters.length) op.parameters = parameters;

  if (route.request?.body) {
    const multipart = getMultipartShape(route.request.body);
    if (multipart) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [name, fieldSchema] of Object.entries(multipart.shape)) {
        const fileOpts = getFileFieldOptions(fieldSchema);
        if (fileOpts) {
          const propSchema: Record<string, unknown> = {
            type: "string",
            format: fileOpts.format,
          };
          if (fileOpts.accept && fileOpts.accept.length > 0) {
            propSchema["x-accept"] = fileOpts.accept;
          }
          if (fileOpts.maxBytes !== undefined) {
            propSchema["x-max-bytes"] = fileOpts.maxBytes;
          }
          if (fileOpts.magicBytes !== undefined) {
            propSchema["x-magic-bytes"] = fileOpts.magicBytes === true ? true : "custom";
          }
          properties[name] = propSchema;
          if (!fileOpts.optional) required.push(name);
        } else {
          properties[name] = toJsonSchema(fieldSchema) ?? {};
          if (!isOptionalSchema(fieldSchema)) required.push(name);
        }
      }
      op.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              ...(required.length ? { required } : {}),
              ...(multipart.strict ? { additionalProperties: false } : {}),
              properties,
            },
          },
        },
      };
    } else {
      const bodyContent: Record<string, unknown> = {
        schema: toJsonSchema(route.request.body) ?? {},
      };
      const requestExamples = collectRequestBodyExamples(meta);
      if (requestExamples) bodyContent.examples = requestExamples;
      op.requestBody = {
        required: true,
        content: { "application/json": bodyContent },
      };
    }
  }

  const responses: Record<string, unknown> = {};
  const responseEntries = Object.entries(route.responses) as Array<[
    string,
    import("./types.js").ResponseSpec | undefined
  ]>;
  for (const [status, spec] of responseEntries) {
    if (!spec) continue;
    const metaResponseExamples = collectResponseExamples(meta, Number(status));
    const mergedExamples =
      spec.examples || metaResponseExamples
        ? { ...(metaResponseExamples ?? {}), ...(spec.examples ?? {}) }
        : undefined;
    responses[status] = {
      description: spec.description,
      ...(spec.body
        ? {
            content: {
              "application/json": {
                schema: toJsonSchema(spec.body) ?? {},
                ...(mergedExamples ? { examples: mergedExamples } : {}),
              },
            },
          }
        : {}),
    };
  }
  op.responses = responses;

  if (route.auth) {
    op.security = [{ [route.auth.scheme]: route.auth.scopes ?? [] }];
  }

  const callbacks = buildCallbacks(
    (route as { callbacks?: CallbackMap }).callbacks
  );
  if (callbacks) op.callbacks = callbacks;

  if (meta?.extensions) {
    for (const [k, v] of Object.entries(meta.extensions)) {
      const key = k.startsWith("x-") ? k : `x-${k}`;
      op[key] = v;
    }
  }
  if (meta?.examples && Object.keys(meta.examples).length > 0) {
    op["x-daloy-examples"] = meta.examples;
  }

  return op;
}

function mergeTags(routeTags: string[] | undefined, metaTags: string[] | undefined): string[] {
  if (!routeTags && !metaTags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...(routeTags ?? []), ...(metaTags ?? [])]) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function collectRequestBodyExamples(meta: RouteMeta | undefined): Record<string, unknown> | undefined {
  if (!meta?.examples) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, ex] of Object.entries(meta.examples)) {
    if (ex.request?.body === undefined) continue;
    const entry: Record<string, unknown> = { value: ex.request.body };
    if (ex.summary) entry.summary = ex.summary;
    if (ex.description) entry.description = ex.description;
    out[name] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function collectResponseExamples(
  meta: RouteMeta | undefined,
  status: number
): Record<string, unknown> | undefined {
  if (!meta?.examples) return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, ex] of Object.entries(meta.examples)) {
    if (!ex.response || ex.response.status !== status || ex.response.body === undefined) {
      continue;
    }
    const entry: Record<string, unknown> = { value: ex.response.body };
    if (ex.summary) entry.summary = ex.summary;
    if (ex.description) entry.description = ex.description;
    out[name] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildCallbacks(
  callbacks: CallbackMap | undefined
): Record<string, Record<string, Record<string, unknown>>> | undefined {
  if (!callbacks) return undefined;
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [name, def] of Object.entries(callbacks)) {
    const cb = buildCallback(def);
    if (cb) out[name] = cb;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildCallback(
  def: CallbackDefinition
): Record<string, Record<string, unknown>> | undefined {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [expression, opOrOps] of Object.entries(def)) {
    const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
    if (ops.length === 0) continue;
    const pathItem: Record<string, unknown> = {};
    for (const op of ops) {
      pathItem[op.method.toLowerCase()] = buildOperation(op);
    }
    out[expression] = pathItem;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildWebhooks(
  webhooks: OpenAPIOptions["webhooks"]
): Record<string, Record<string, unknown>> | undefined {
  if (!webhooks) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, defOrDefs] of Object.entries(webhooks)) {
    const defs = Array.isArray(defOrDefs) ? defOrDefs : [defOrDefs];
    if (defs.length === 0) continue;
    const pathItem: Record<string, unknown> = {};
    for (const def of defs) {
      pathItem[def.method.toLowerCase()] = buildOperation(def);
    }
    out[name] = pathItem;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function toJsonSchema(schema: StandardSchemaV1 | undefined): unknown | undefined {
  if (!schema) return undefined;
  const anySchema = schema as any;
  // Zod 4 has `.toJSONSchema()`; Valibot/TypeBox vary by adapter/version.
  if (typeof anySchema.toJSONSchema === "function") {
    try {
      return anySchema.toJSONSchema();
    } catch {
      /* fall through */
    }
  }
  if (anySchema._def && typeof anySchema._def === "object") {
    // Zod fallback — tiny heuristic; real apps should pass `.toJSONSchema()`-capable schemas.
    return zodFallback(anySchema);
  }
  return {};
}

function extractPropertySchema(
  schema: StandardSchemaV1 | undefined,
  prop: string
): unknown | undefined {
  if (!schema) return undefined;
  const js = toJsonSchema(schema) as any;
  return js?.properties?.[prop];
}

function isOptionalSchema(schema: StandardSchemaV1): boolean {
  return (schema as any).isOptional?.() === true;
}

function zodFallback(z: any): unknown {
  const t = z._def?.typeName ?? z._def?.type;
  switch (t) {
    case "ZodString":
    case "string":
      return { type: "string" };
    case "ZodNumber":
    case "number":
      return { type: "number" };
    case "ZodBoolean":
    case "boolean":
      return { type: "boolean" };
    case "object":
    case "ZodObject": {
      const shape = typeof z._def.shape === "function" ? z._def.shape() : z._def.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries<any>(shape)) {
        properties[k] = zodFallback(v);
        if (!v.isOptional?.()) required.push(k);
      }
      return { type: "object", properties, required };
    }
    case "ZodArray":
    case "array":
      return { type: "array", items: zodFallback(z._def.element ?? z._def.type) };
    case "ZodOptional":
    case "optional":
    case "ZodNullable":
    case "nullable":
      return zodFallback(z._def.innerType);
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// YAML serializer for OpenAPI documents
// ---------------------------------------------------------------------------

const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
const YAML_NUMERIC = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const YAML_SPECIAL_FIRST = /^[\s\-?:,\[\]{}#&*!|>'"%@`]/;

function yamlNeedsQuoting(s: string): boolean {
  if (s === "") return true;
  if (YAML_SPECIAL_FIRST.test(s)) return true;
  if (/[:#\n\r\t]/.test(s)) return true;
  if (/\s$/.test(s)) return true;
  if (YAML_RESERVED.test(s)) return true;
  if (YAML_NUMERIC.test(s)) return true;
  return false;
}

function yamlQuote(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "string") return yamlNeedsQuoting(v) ? yamlQuote(v) : v;
  return yamlQuote(String(v));
}

function yamlKey(k: string): string {
  return yamlNeedsQuoting(k) ? yamlQuote(k) : k;
}

function yamlRenderKV(k: string, v: unknown, prefix: string, childIndent: string): string {
  const key = yamlKey(k);
  if (v !== null && typeof v === "object") {
    const isEmpty = Array.isArray(v) ? v.length === 0 : Object.keys(v as object).length === 0;
    if (isEmpty) {
      return `${prefix}${key}: ${Array.isArray(v) ? "[]" : "{}"}\n`;
    }
    return `${prefix}${key}:${yamlEmit(v, childIndent)}`;
  }
  return `${prefix}${key}: ${yamlScalar(v)}\n`;
}

function yamlEmit(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return " []\n";
    let out = "\n";
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) {
          out += `${indent}- {}\n`;
          continue;
        }
        let first = true;
        for (const [k, v] of entries) {
          const prefix = first ? `${indent}- ` : `${indent}  `;
          first = false;
          out += yamlRenderKV(k, v, prefix, indent + "    ");
        }
      } else if (Array.isArray(item)) {
        out += `${indent}-${yamlEmit(item, indent + "  ")}`;
      } else {
        out += `${indent}- ${yamlScalar(item)}\n`;
      }
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return " {}\n";
    let out = "\n";
    for (const [k, v] of entries) {
      out += yamlRenderKV(k, v, indent, indent + "  ");
    }
    return out;
  }
  return ` ${yamlScalar(value)}\n`;
}

/**
 * Serialize an OpenAPI document (or any JSON-safe object) as YAML 1.2.
 *
 * Pure function with no runtime dependency. Output is the canonical form
 * consumed by Swagger UI's `/swagger.yaml` style endpoints.
 *
 * @since 0.13.1
 */
/**
 * Serialize an OpenAPI document (from {@link generateOpenAPI}) to YAML using a
 * minimal built-in emitter. No external dependencies; suitable for build-time
 * artifacts. Reads/writes nothing; pure transform.
 */
export function openapiToYAML(doc: Record<string, unknown>): string {
  const result = yamlEmit(doc, "");
  return result.startsWith("\n") ? result.slice(1) : result;
}

