/**
 * Pure helpers that turn an OpenAPI 3.1 document into a render-ready list of
 * operations for `<OpenApiReference>`: `$ref`s resolved, JSON Schemas
 * flattened to property rows, and request samples generated.
 */

type Json = Record<string, unknown>;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** A flattened schema property (`address.city`, `items[]`). */
export type SchemaRow = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: string;
};

/** One parameter (path, query, header or cookie). */
export type ParameterView = SchemaRow & { in: string };

/** One documented response. */
export type ResponseView = {
  status: string;
  description: string;
  contentType?: string;
  rows: SchemaRow[];
  headers: SchemaRow[];
};

/** A render-ready operation. */
export type OperationView = {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /**
   * `true` when credentials are mandatory: at least one security requirement
   * applies and none of them is the empty `{}` (anonymous) requirement.
   */
  requiresAuth: boolean;
  /** `true` when a token is accepted but anonymous access is also allowed (`[{ oauth2: [] }, {}]`). */
  optionalAuth: boolean;
  deprecated: boolean;
  parameters: ParameterView[];
  requestBody?: { contentType: string; required: boolean; rows: SchemaRow[] };
  responses: ResponseView[];
};

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve a local `$ref` (`#/components/...`). External refs are left as-is.
 * Guards against cycles by tracking the refs on the current path.
 */
function deref(doc: Json, value: unknown, seen: ReadonlySet<string> = new Set()): unknown {
  if (!isObject(value) || typeof value.$ref !== "string") return value;
  const ref = value.$ref;
  if (!ref.startsWith("#/") || seen.has(ref)) return { type: "object", description: `See ${ref.split("/").pop()}` };
  let target: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(target) || !Object.hasOwn(target, key)) return value;
    target = target[key];
  }
  return deref(doc, target, new Set([...seen, ref]));
}

/**
 * Short, human-readable type label for a JSON Schema: `string<uri>`,
 * `"a" | "b"`, `integer[]`, `TokenResponse`, `string | null`.
 *
 * @param doc - The full document, for `$ref` resolution.
 * @param schema - The schema to describe.
 * @returns The label.
 */
export function schemaType(doc: Json, schema: unknown): string {
  if (isObject(schema) && typeof schema.$ref === "string") return schema.$ref.split("/").pop() ?? "object";
  const resolved = deref(doc, schema);
  if (!isObject(resolved)) return "unknown";
  if ("const" in resolved) return JSON.stringify(resolved.const);
  if (Array.isArray(resolved.enum)) return resolved.enum.map((value) => JSON.stringify(value)).join(" | ");
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(resolved[key])) return (resolved[key] as unknown[]).map((part) => schemaType(doc, part)).join(" | ");
  }
  if (Array.isArray(resolved.type)) return resolved.type.join(" | ");
  if (resolved.type === "array") return `${schemaType(doc, resolved.items)}[]`;
  if (typeof resolved.type === "string") {
    return typeof resolved.format === "string" ? `${resolved.type}<${resolved.format}>` : resolved.type;
  }
  return isObject(resolved.properties) ? "object" : "unknown";
}

/**
 * Flatten an object schema to rows, descending into nested objects and
 * arrays of objects up to `depth` levels (`user.name`, `items[].id`).
 *
 * @param doc - The full document, for `$ref` resolution.
 * @param schema - Object schema.
 * @param prefix - Name prefix for nested rows.
 * @param depth - Remaining nesting levels.
 * @returns Property rows in declaration order.
 */
export function schemaRows(doc: Json, schema: unknown, prefix = "", depth = 3): SchemaRow[] {
  const resolved = deref(doc, schema);
  if (!isObject(resolved)) return [];
  if (resolved.type === "array" && prefix === "") return schemaRows(doc, resolved.items, "[]", depth);
  if (!isObject(resolved.properties)) return [];
  const required = new Set(Array.isArray(resolved.required) ? (resolved.required as string[]) : []);
  const rows: SchemaRow[] = [];
  for (const [key, raw] of Object.entries(resolved.properties)) {
    const property = deref(doc, raw);
    const name = prefix ? `${prefix}.${key}`.replace(/^\[\]\./, "[].") : key;
    const row: SchemaRow = { name, type: schemaType(doc, raw), required: required.has(key) };
    if (isObject(property) && typeof property.description === "string") row.description = property.description;
    if (isObject(property) && "default" in property) row.default = JSON.stringify(property.default);
    rows.push(row);
    // Inline objects are expanded; named `$ref` schemas stay as their type
    // name, so self-references and shared models are not repeated.
    const isRef = (value: unknown) => isObject(value) && typeof value.$ref === "string";
    if (depth > 1 && isObject(property) && !isRef(raw)) {
      if (isObject(property.properties)) rows.push(...schemaRows(doc, property, name, depth - 1));
      else if (property.type === "array" && !isRef(property.items)) {
        rows.push(...schemaRows(doc, property.items, `${name}[]`, depth - 1));
      }
    }
  }
  return rows;
}

function firstContent(content: unknown): { contentType: string; schema: unknown } | undefined {
  if (!isObject(content)) return undefined;
  const [contentType, media] = Object.entries(content)[0] ?? [];
  if (!contentType) return undefined;
  return { contentType, schema: isObject(media) ? media.schema : undefined };
}

/**
 * Build the operation list for a document, in path order, tagged with the
 * operation's first tag (or `"Other"`).
 *
 * @param spec - An OpenAPI 3.x document (already parsed JSON).
 * @returns Render-ready operations.
 */
export function buildOperations(spec: Json): OperationView[] {
  const operations: OperationView[] = [];
  const defaultSecurity = Array.isArray(spec.security) ? spec.security : [];

  for (const [path, rawItem] of Object.entries(isObject(spec.paths) ? spec.paths : {})) {
    const item = deref(spec, rawItem);
    if (!isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];

    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;

      const parameters = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]
        .map((raw) => deref(spec, raw))
        .filter(isObject)
        .map((param) => ({
          name: String(param.name ?? ""),
          in: String(param.in ?? "query"),
          type: schemaType(spec, param.schema),
          required: param.required === true || param.in === "path",
          ...(typeof param.description === "string" ? { description: param.description } : {}),
        }));

      const body = deref(spec, op.requestBody);
      const bodyContent = isObject(body) ? firstContent(body.content) : undefined;

      const responses = Object.entries(isObject(op.responses) ? op.responses : {}).map(([status, raw]) => {
        const response = deref(spec, raw);
        const content = isObject(response) ? firstContent(response.content) : undefined;
        const headers = isObject(response) && isObject(response.headers) ? response.headers : {};
        return {
          status,
          description: isObject(response) && typeof response.description === "string" ? response.description : "",
          ...(content ? { contentType: content.contentType } : {}),
          rows: content ? schemaRows(spec, content.schema) : [],
          headers: Object.entries(headers).map(([name, rawHeader]) => {
            const header = deref(spec, rawHeader);
            return {
              name,
              type: schemaType(spec, isObject(header) ? header.schema : undefined),
              required: isObject(header) && header.required === true,
              ...(isObject(header) && typeof header.description === "string" ? { description: header.description } : {}),
            };
          }),
        } satisfies ResponseView;
      });

      // Operation security overrides the document default. An empty
      // requirement object `{}` means "anonymous is allowed".
      const security: unknown[] = Array.isArray(op.security) ? op.security : defaultSecurity;
      const named = security.filter((entry) => isObject(entry) && Object.keys(entry).length > 0);
      const anonymous = security.length === 0 || security.some((entry) => isObject(entry) && Object.keys(entry).length === 0);
      operations.push({
        id: typeof op.operationId === "string" ? op.operationId : `${method}-${path}`.replace(/[^\w-]+/g, "-"),
        method: method.toUpperCase(),
        path,
        tag: Array.isArray(op.tags) && typeof op.tags[0] === "string" ? op.tags[0] : "Other",
        summary: typeof op.summary === "string" ? op.summary : `${method.toUpperCase()} ${path}`,
        ...(typeof op.description === "string" ? { description: op.description } : {}),
        requiresAuth: named.length > 0 && !anonymous,
        optionalAuth: named.length > 0 && anonymous,
        deprecated: op.deprecated === true,
        parameters,
        ...(isObject(body) && bodyContent
          ? { requestBody: { contentType: bodyContent.contentType, required: body.required === true, rows: schemaRows(spec, bodyContent.schema) } }
          : {}),
        responses,
      });
    }
  }

  return operations;
}

/** Shell-quote a value for a curl sample (single quotes, POSIX). */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Generate illustrative request samples. Path parameters become `{name}`
 * placeholders, credentials become `$TOKEN`, and bodies are skeletons built
 * from the schema's property names.
 *
 * @param op - The operation.
 * @param baseUrl - Server URL, e.g. `https://daloyjs.dev`.
 * @returns curl and fetch samples.
 */
export function requestSamples(op: OperationView, baseUrl: string): { curl: string; fetch: string } {
  const url = `${baseUrl.replace(/\/+$/, "")}${op.path}`;
  const headers: string[] = [];
  if (op.requiresAuth || op.optionalAuth) headers.push("Authorization: Bearer $TOKEN");
  let body: string | undefined;
  if (op.requestBody) {
    headers.push(`Content-Type: ${op.requestBody.contentType}`);
    const topLevel = op.requestBody.rows.filter((row) => !row.name.includes(".") && !row.name.startsWith("["));
    if (op.requestBody.contentType === "application/x-www-form-urlencoded") {
      body = topLevel.map((row) => `${row.name}=${row.type.startsWith('"') ? row.type.split(" | ")[0]!.slice(1, -1) : "…"}`).join("&");
    } else {
      body = JSON.stringify(Object.fromEntries(topLevel.map((row) => [row.name, row.type.startsWith('"') ? JSON.parse(row.type.split(" | ")[0]!) : `<${row.type}>`])), null, 2);
    }
  }

  const curl = [
    `curl -X ${op.method} ${shellQuote(url)}`,
    ...headers.map((header) => `  -H ${header.includes("$TOKEN") ? `"${header}"` : shellQuote(header)}`),
    ...(body !== undefined ? [`  --data ${shellQuote(body)}`] : []),
  ].join(" \\\n");

  const init: string[] = [`  method: "${op.method}",`];
  if (headers.length) {
    init.push("  headers: {");
    for (const header of headers) {
      const colon = header.indexOf(": ");
      const name = header.slice(0, colon);
      const value = header.slice(colon + 2);
      init.push(`    ${JSON.stringify(name)}: ${value === "Bearer $TOKEN" ? "`Bearer ${token}`" : JSON.stringify(value)},`);
    }
    init.push("  },");
  }
  if (body !== undefined) {
    init.push(
      op.requestBody?.contentType === "application/json"
        ? `  body: JSON.stringify(${body.replace(/\n/g, "\n  ")}),`
        : `  body: ${JSON.stringify(body)},`
    );
  }
  const fetchSample = `const response = await fetch(${JSON.stringify(url)}, {\n${init.join("\n")}\n});\nconsole.log(response.status, await response.text());`;

  return { curl, fetch: fetchSample };
}
