/**
 * OpenAPI 3.1 document generator.
 *
 * Built-in (not a plugin afterthought) — that's the whole point.
 *
 * If a schema exposes a `toJSONSchema()` method (Zod 3.23+, Valibot, etc.)
 * we use it. Otherwise we emit a permissive `{}` placeholder rather than
 * fail — codegen and docs still work, just with looser types for that field.
 */

import type { App } from "./app.js";
import type { RouteDefinition } from "./types.js";
import type { StandardSchemaV1 } from "./schema.js";

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface SecuritySchemeMap {
  [name: string]: Record<string, unknown>;
}

export interface OpenAPIOptions {
  info: OpenAPIInfo;
  servers?: Array<{ url: string; description?: string }>;
  securitySchemes?: SecuritySchemeMap;
}

export function generateOpenAPI(app: App, options: OpenAPIOptions): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of app.routes) {
    const oasPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    paths[oasPath] ??= {};
    paths[oasPath]![route.method.toLowerCase()] = buildOperation(route);
  }

  return {
    openapi: "3.1.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
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

function buildOperation(route: RouteDefinition<any, any, any, any>): Record<string, unknown> {
  const op: Record<string, unknown> = {
    ...(route.operationId ? { operationId: route.operationId } : {}),
    ...(route.summary ? { summary: route.summary } : {}),
    ...(route.description ? { description: route.description } : {}),
    ...(route.tags?.length ? { tags: route.tags } : {}),
    ...(route.deprecated ? { deprecated: true } : {}),
  };

  const parameters: Array<Record<string, unknown>> = [];

  // Path params: emit one entry per :name in the path.
  const paramNames = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
  for (const name of paramNames) {
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: extractPropertySchema(route.request?.params, name) ?? { type: "string" },
    });
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
    op.requestBody = {
      required: true,
      content: {
        "application/json": { schema: toJsonSchema(route.request.body) ?? {} },
      },
    };
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

  return op;
}

function toJsonSchema(schema: StandardSchemaV1 | undefined): unknown | undefined {
  if (!schema) return undefined;
  const anySchema = schema as any;
  // Zod 3.23+ has `.toJSONSchema()` via its standard interop; Valibot/TypeBox vary.
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

function zodFallback(z: any): unknown {
  const t = z._def?.typeName;
  switch (t) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodObject": {
      const shape = z._def.shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries<any>(shape)) {
        properties[k] = zodFallback(v);
        if (!v.isOptional?.()) required.push(k);
      }
      return { type: "object", properties, required };
    }
    case "ZodArray":
      return { type: "array", items: zodFallback(z._def.type) };
    case "ZodOptional":
    case "ZodNullable":
      return zodFallback(z._def.innerType);
    default:
      return {};
  }
}
