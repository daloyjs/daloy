/**
 * Task registry. Add a new task by creating `evals/tasks/<id>/task.ts`
 * (exporting `task`) plus `evals/tasks/<id>/hidden/*.test.ts`, then listing
 * it here. `tests/evals-harness.test.ts` checks the registry's integrity and
 * `pnpm eval:calibrate` proves the graders accept the reference solution and
 * reject every unsafe variant.
 *
 * @module
 */

import type { EvalTask } from "../lib/types.ts";
import { task as guardrailAdminApiKey } from "./guardrail-admin-api-key/task.ts";
import { task as guardrailBodyLimit } from "./guardrail-body-limit/task.ts";
import { task as guardrailRateLimitHealthz } from "./guardrail-rate-limit-healthz/task.ts";
import { task as guardrailStrictExtraField } from "./guardrail-strict-extra-field/task.ts";
import { task as migrationExpressNotes } from "./migration-express-notes/task.ts";
import { task as scaffoldBooksList } from "./scaffold-books-list/task.ts";
import { task as scaffoldUsersCrud } from "./scaffold-users-crud/task.ts";

/** Every eval task, in report order. */
export const TASKS: readonly EvalTask[] = [
  guardrailBodyLimit,
  guardrailRateLimitHealthz,
  guardrailStrictExtraField,
  guardrailAdminApiKey,
  scaffoldUsersCrud,
  scaffoldBooksList,
  migrationExpressNotes,
];
