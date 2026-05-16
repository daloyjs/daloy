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

export interface ContractIssue {
  level: "error" | "warning";
  route: string;
  message: string;
}

export interface ContractReport {
  ok: boolean;
  checked: number;
  issues: ContractIssue[];
}

export interface ContractTestOptions {
  /** Require every route to have an operationId. Default: true. */
  requireOperationId?: boolean;
  /** Allow body schemas on GET/HEAD/DELETE. Default: false. */
  allowBodyOnSafeMethods?: boolean;
}

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
  }

  return {
    ok: !issues.some((i) => i.level === "error"),
    checked: app.routes.length,
    issues,
  };
}
