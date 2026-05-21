/**
 * Contract-test runner.
 *
 * Iterates every registered route and verifies:
 *   - declared response examples (if any) actually validate against the
 *     declared response body schema
 *   - duplicate operationIds, missing operationIds, and dead routes
 *   - that no route declares a `body` schema for GET/HEAD/DELETE without
 *     opting in via `allowBodyOnSafeMethods`
 *
 * Returns a structured report. CI should `process.exit(1)` if `ok === false`.
 */

import type { App } from "./app.js";
import { validate } from "./schema.js";

/** A single problem surfaced by {@link runContractTests}. */
export interface ContractIssue {
  /** `"error"` blocks publishing; `"warning"` is informational. */
  level: "error" | "warning";
  /** Identifier for the offending route (e.g. `"GET /books/{id}"`). */
  route: string;
  /** Human-readable description of the problem. */
  message: string;
}

/** Result of {@link runContractTests}. CI should treat `ok === false` as a failure. */
export interface ContractReport {
  /** `true` when no `"error"`-level issues were reported. */
  ok: boolean;
  /** Number of routes that were inspected. */
  checked: number;
  /** All collected issues, in route-declaration order. */
  issues: ContractIssue[];
}

/** Options for {@link runContractTests}. */
export interface ContractTestOptions {
  /** Require every route to have an operationId. Default: true. */
  requireOperationId?: boolean;
  /** Allow body schemas on GET/HEAD/DELETE. Default: false. */
  allowBodyOnSafeMethods?: boolean;
}

/**
 * Run contract checks against every route registered on `app`.
 *
 * Verifies that declared response/request examples validate against their
 * schemas, that `operationId`s are present and unique, that GET/HEAD/DELETE
 * routes don't carry body schemas by accident, and that `meta.examples`
 * reference declared response statuses.
 *
 * @returns A {@link ContractReport}. In CI, exit non-zero when `report.ok` is `false`.
 */
export async function runContractTests(
  app: App,
  opts: ContractTestOptions = {}
): Promise<ContractReport> {
  const requireOperationId = opts.requireOperationId ?? true;
  const allowBodyOnSafeMethods = opts.allowBodyOnSafeMethods ?? false;

  const issues: ContractIssue[] = [];
  const seenOpIds = new Map<string, string>();

  for (const r of app.routes) {
    const id = `${r.method} ${r.path}`;

    if (requireOperationId && !r.operationId) {
      issues.push({ level: "error", route: id, message: "Missing operationId" });
    }
    if (r.operationId) {
      const prior = seenOpIds.get(r.operationId);
      if (prior) {
        issues.push({
          level: "error",
          route: id,
          message: `Duplicate operationId "${r.operationId}" (also on ${prior})`,
        });
      } else {
        seenOpIds.set(r.operationId, id);
      }
    }

    if (
      !allowBodyOnSafeMethods &&
      r.request?.body &&
      (r.method === "GET" || r.method === "HEAD" || r.method === "DELETE")
    ) {
      issues.push({
        level: "warning",
        route: id,
        message: `Body schema declared on ${r.method} (likely a mistake)`,
      });
    }

    if (Object.keys(r.responses).length === 0) {
      issues.push({ level: "error", route: id, message: "No responses declared" });
    }

    // Validate examples against schemas.
    const responseEntries = Object.entries(r.responses) as Array<[
      string,
      import("./types.js").ResponseSpec | undefined
    ]>;
    for (const [status, spec] of responseEntries) {
      if (!spec) continue;
      if (spec.body && spec.examples) {
        for (const [name, example] of Object.entries(spec.examples)) {
          const result = await validate(spec.body, example);
          if (result.issues) {
            issues.push({
              level: "error",
              route: id,
              message: `Example "${name}" for ${status} violates schema: ${result.issues
                .map((i) => i.message)
                .join("; ")}`,
            });
          }
        }
      }
    }

    // Validate meta.examples against request/response schemas.
    const meta = r.meta;
    if (meta?.examples) {
      for (const [name, ex] of Object.entries(meta.examples)) {
        if (ex.request) {
          const checks: Array<[string, import("./schema.js").StandardSchemaV1 | undefined, unknown]> = [
            ["request.body", r.request?.body, ex.request.body],
            ["request.query", r.request?.query, ex.request.query],
            ["request.params", r.request?.params, ex.request.params],
            ["request.headers", r.request?.headers, ex.request.headers],
          ];
          for (const [label, schema, value] of checks) {
            if (!schema || value === undefined) continue;
            const result = await validate(schema, value);
            if (result.issues) {
              issues.push({
                level: "error",
                route: id,
                message: `meta.examples["${name}"].${label} violates schema: ${result.issues
                  .map((i) => i.message)
                  .join("; ")}`,
              });
            }
          }
        }
        if (ex.response) {
          const respSpec = r.responses[ex.response.status as keyof typeof r.responses];
          if (!respSpec) {
            issues.push({
              level: "error",
              route: id,
              message: `meta.examples["${name}"].response.status ${ex.response.status} is not declared in responses`,
            });
          } else if (ex.response.body !== undefined && respSpec.body) {
            const result = await validate(respSpec.body, ex.response.body);
            if (result.issues) {
              issues.push({
                level: "error",
                route: id,
                message: `meta.examples["${name}"].response.body violates schema for ${ex.response.status}: ${result.issues
                  .map((i) => i.message)
                  .join("; ")}`,
              });
            }
          }
        }
      }
    }
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    checked: app.routes.length,
    issues,
  };
}
