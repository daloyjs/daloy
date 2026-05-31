/**
 * `@daloyjs/core/openapi-diff` — pure, dependency-free OpenAPI 3.x diffing.
 *
 * Compares two OpenAPI documents (a published *baseline* and a freshly
 * generated *current* spec) and classifies every structural change as either
 * **breaking** (a consumer relying on the baseline could now fail) or
 * **non-breaking** (purely additive / informational). This is the engine
 * behind the `daloy diff` CLI command and the `verify:breaking-changes` CI
 * gate, answering the single question a contract-first framework should make
 * trivial: *"did this change break my published API?"*
 *
 * The implementation walks plain JSON and never imports a schema validator or
 * any runtime dependency, so it can run in any environment that can read two
 * JSON files.
 *
 * @module
 * @since 0.37.0
 */

/** Severity classification for a single detected change. */
export type ChangeSeverity = "breaking" | "non-breaking";

/**
 * A single structural difference between two OpenAPI documents.
 */
export interface OpenAPIChange {
  /** Whether this change can break an existing consumer. */
  severity: ChangeSeverity;
  /**
   * Stable machine-readable category, e.g. `"operation.removed"`,
   * `"response.removed"`, `"parameter.required.added"`.
   */
  kind: string;
  /** Human-readable pointer, e.g. `"GET /books/{id}"` or `"GET /books → 404"`. */
  location: string;
  /** Short prose describing the change. */
  detail: string;
}

/** Structured result of {@link diffOpenAPI}. */
export interface OpenAPIDiffResult {
  /** Changes that may break an existing consumer. */
  breaking: OpenAPIChange[];
  /** Additive or informational changes that are safe for consumers. */
  nonBreaking: OpenAPIChange[];
}

/** HTTP methods recognized on an OpenAPI Path Item Object. */
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

type JsonObject = Record<string, unknown>;

/** Narrow an unknown value to a plain object (non-null, non-array). */
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract the `paths` object from a document, tolerating malformed input. */
function pathsOf(doc: unknown): JsonObject {
  if (isObject(doc) && isObject(doc.paths)) return doc.paths;
  return {};
}

/** Extract the OpenAPI Operation Objects keyed by HTTP method for a path item. */
function operationsOf(pathItem: unknown): Map<string, JsonObject> {
  const ops = new Map<string, JsonObject>();
  if (!isObject(pathItem)) return ops;
  for (const method of HTTP_METHODS) {
    const op = pathItem[method];
    if (isObject(op)) ops.set(method, op);
  }
  return ops;
}

/** Build a `${in}:${name}` keyed map of an operation's parameter objects. */
function parametersOf(op: JsonObject): Map<string, JsonObject> {
  const out = new Map<string, JsonObject>();
  const params = op.parameters;
  if (!Array.isArray(params)) return out;
  for (const p of params) {
    if (!isObject(p)) continue;
    const name = typeof p.name === "string" ? p.name : "";
    const loc = typeof p.in === "string" ? p.in : "";
    if (name === "") continue;
    out.set(`${loc}:${name}`, p);
  }
  return out;
}

/** True when a parameter object is marked `required: true`. */
function isRequiredParam(p: JsonObject): boolean {
  return p.required === true;
}

/** True when an operation's request body is marked `required: true`. */
function requestBodyRequired(op: JsonObject): boolean {
  return isObject(op.requestBody) && op.requestBody.required === true;
}

/**
 * Compare a baseline OpenAPI document against a current one and classify the
 * differences. The comparison is intentionally conservative: anything that
 * could cause a request that succeeded against the baseline to fail against
 * the current spec is reported as **breaking**; additive and metadata-only
 * changes are reported as **non-breaking**.
 *
 * Detected breaking changes:
 * - a path or operation (HTTP method) present in the baseline is removed;
 * - a documented response status code is removed from an operation;
 * - a new `required` parameter is added to an existing operation;
 * - an existing optional parameter becomes `required`;
 * - an operation's request body becomes required when it was not.
 *
 * Detected non-breaking changes:
 * - new paths, operations, response codes, or optional parameters;
 * - a parameter is removed (the server no longer reads it);
 * - an operation becomes `deprecated`;
 * - the document `info.version` changes.
 *
 * @param baseline - The previously published OpenAPI document (JSON).
 * @param current - The freshly generated OpenAPI document (JSON).
 * @returns Structured lists of breaking and non-breaking changes.
 * @since 0.37.0
 */
export function diffOpenAPI(baseline: unknown, current: unknown): OpenAPIDiffResult {
  const breaking: OpenAPIChange[] = [];
  const nonBreaking: OpenAPIChange[] = [];

  const basePaths = pathsOf(baseline);
  const curPaths = pathsOf(current);

  // info.version change (informational).
  const baseVersion =
    isObject(baseline) && isObject(baseline.info) ? baseline.info.version : undefined;
  const curVersion = isObject(current) && isObject(current.info) ? current.info.version : undefined;
  if (baseVersion !== curVersion) {
    nonBreaking.push({
      severity: "non-breaking",
      kind: "info.version.changed",
      location: "info.version",
      detail: `version changed from ${JSON.stringify(baseVersion)} to ${JSON.stringify(curVersion)}`,
    });
  }

  for (const [path, baseItem] of Object.entries(basePaths)) {
    const curItem = curPaths[path];
    const baseOps = operationsOf(baseItem);
    const curOps = operationsOf(curItem);

    for (const [method, baseOp] of baseOps) {
      const where = `${method.toUpperCase()} ${path}`;
      const curOp = curOps.get(method);
      if (!curOp) {
        breaking.push({
          severity: "breaking",
          kind: "operation.removed",
          location: where,
          detail: `operation ${where} was removed`,
        });
        continue;
      }

      diffResponses(baseOp, curOp, where, breaking);
      diffParameters(baseOp, curOp, where, breaking, nonBreaking);
      diffRequestBody(baseOp, curOp, where, breaking);

      if (curOp.deprecated === true && baseOp.deprecated !== true) {
        nonBreaking.push({
          severity: "non-breaking",
          kind: "operation.deprecated",
          location: where,
          detail: `operation ${where} is now deprecated`,
        });
      }
    }

    // Operations added to an existing path.
    for (const [method] of curOps) {
      if (!baseOps.has(method)) {
        nonBreaking.push({
          severity: "non-breaking",
          kind: "operation.added",
          location: `${method.toUpperCase()} ${path}`,
          detail: `operation ${method.toUpperCase()} ${path} was added`,
        });
      }
    }
  }

  // Entirely new paths.
  for (const [path, curItem] of Object.entries(curPaths)) {
    if (path in basePaths) continue;
    for (const [method] of operationsOf(curItem)) {
      nonBreaking.push({
        severity: "non-breaking",
        kind: "operation.added",
        location: `${method.toUpperCase()} ${path}`,
        detail: `operation ${method.toUpperCase()} ${path} was added`,
      });
    }
  }

  return { breaking, nonBreaking };
}

/** Report response status codes that existed in the baseline but were removed. */
function diffResponses(
  baseOp: JsonObject,
  curOp: JsonObject,
  where: string,
  breaking: OpenAPIChange[]
): void {
  const baseResponses = isObject(baseOp.responses) ? baseOp.responses : {};
  const curResponses = isObject(curOp.responses) ? curOp.responses : {};
  for (const status of Object.keys(baseResponses)) {
    if (!(status in curResponses)) {
      breaking.push({
        severity: "breaking",
        kind: "response.removed",
        location: `${where} → ${status}`,
        detail: `response ${status} was removed from ${where}`,
      });
    }
  }
}

/** Report parameter additions, removals, and requirement tightening. */
function diffParameters(
  baseOp: JsonObject,
  curOp: JsonObject,
  where: string,
  breaking: OpenAPIChange[],
  nonBreaking: OpenAPIChange[]
): void {
  const baseParams = parametersOf(baseOp);
  const curParams = parametersOf(curOp);

  for (const [key, baseParam] of baseParams) {
    const curParam = curParams.get(key);
    if (!curParam) {
      nonBreaking.push({
        severity: "non-breaking",
        kind: "parameter.removed",
        location: `${where} (${key})`,
        detail: `parameter ${key} was removed from ${where}`,
      });
      continue;
    }
    if (!isRequiredParam(baseParam) && isRequiredParam(curParam)) {
      breaking.push({
        severity: "breaking",
        kind: "parameter.required.tightened",
        location: `${where} (${key})`,
        detail: `parameter ${key} on ${where} is now required`,
      });
    }
  }

  for (const [key, curParam] of curParams) {
    if (baseParams.has(key)) continue;
    if (isRequiredParam(curParam)) {
      breaking.push({
        severity: "breaking",
        kind: "parameter.required.added",
        location: `${where} (${key})`,
        detail: `new required parameter ${key} was added to ${where}`,
      });
    } else {
      nonBreaking.push({
        severity: "non-breaking",
        kind: "parameter.added",
        location: `${where} (${key})`,
        detail: `new optional parameter ${key} was added to ${where}`,
      });
    }
  }
}

/** Report a request body that became required when it previously was not. */
function diffRequestBody(
  baseOp: JsonObject,
  curOp: JsonObject,
  where: string,
  breaking: OpenAPIChange[]
): void {
  if (!requestBodyRequired(baseOp) && requestBodyRequired(curOp)) {
    breaking.push({
      severity: "breaking",
      kind: "requestBody.required.added",
      location: where,
      detail: `request body on ${where} is now required`,
    });
  }
}

/**
 * Convenience predicate over {@link diffOpenAPI}: `true` when the current
 * document introduces at least one breaking change versus the baseline.
 *
 * @param baseline - The previously published OpenAPI document (JSON).
 * @param current - The freshly generated OpenAPI document (JSON).
 * @returns `true` if any breaking change was detected.
 * @since 0.37.0
 */
export function hasBreakingChanges(baseline: unknown, current: unknown): boolean {
  return diffOpenAPI(baseline, current).breaking.length > 0;
}
