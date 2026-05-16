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
  RouteDefinition,
} from "./types.js";
import type { StandardSchemaV1 } from "./schema.js";
import type { SecurityScheme } from "./security-schemes.js";
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

export interface OpenAPIInfo {
  title: string;
  version: string;
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

export interface OpenAPIOptions {
  info: OpenAPIInfo;
  servers?: Array<{ url: string; description?: string }>;
  securitySchemes?: SecuritySchemeMap;
  /**
   * Optional OpenAPI 3.1 webhooks. Each key is a webhook name; the value is
   * one or more webhook operations (one per HTTP method).
   */
  webhooks?: Record<string, WebhookDefinition | WebhookDefinition[]>;
}

export function generateOpenAPI(app: App, options: OpenAPIOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of app.routes) {
    const oasPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    paths[oasPath] ??= {};
    paths[oasPath]![route.method.toLowerCase()] = buildOperation(route, route.path);
  }

  const webhooks = buildWebhooks(options.webhooks);

  return {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
    ...(webhooks ? { webhooks } : {}),
    components: {
      ...(options.securitySchemes ? { securitySchemes: options.securitySchemes } : {}),
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

type OperationLike =
  | RouteDefinition<any, any, any, any>
  | WebhookDefinition
  | CallbackOperation;

function buildOperation(
  route: OperationLike,
  path?: string
): Record<string, unknown> {
  const op: Record<string, unknown> = {
    ...(route.operationId ? { operationId: route.operationId } : {}),
    ...(route.summary ? { summary: route.summary } : {}),
    ...(route.description ? { description: route.description } : {}),
    ...(route.tags?.length ? { tags: route.tags } : {}),
    ...(route.deprecated ? { deprecated: true } : {}),
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
      op.requestBody = {
        required: true,
        content: {
          "application/json": { schema: toJsonSchema(route.request.body) ?? {} },
        },
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
    responses[status] = {
      description: spec.description,
      ...(spec.body
        ? {
            content: {
              "application/json": {
                schema: toJsonSchema(spec.body) ?? {},
                ...(spec.examples ? { examples: spec.examples } : {}),
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

  return op;
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
