# Historical eval inventory

All 62 blobs from the parent of deletion `232692a5` were verified against Git before changing the books task. The other 14 tasks remain historical baseline code.

| Historical file | Pilot disposition |
|---|---|
| `evals/Dockerfile` | Retain for the existing commands and tests |
| `evals/README.md` | Retain for the existing commands and tests |
| `evals/analyze.ts` | Retain for the existing commands and tests |
| `evals/build-image.ts` | Retain for the existing commands and tests |
| `evals/calibrate.ts` | Retain for the existing commands and tests |
| `evals/compare.ts` | Retain for the existing commands and tests |
| `evals/egress-proxy.ts` | Retain for the existing commands and tests |
| `evals/lib/agents.ts` | Retain for the existing commands and tests |
| `evals/lib/analyze.ts` | Retain for the existing commands and tests |
| `evals/lib/cli.ts` | Retain for the existing commands and tests |
| `evals/lib/docker-sandbox.ts` | Retain for the existing commands and tests |
| `evals/lib/egress.ts` | Retain for the existing commands and tests |
| `evals/lib/graders.ts` | Retain for the existing commands and tests |
| `evals/lib/guardrails.ts` | Retain for the existing commands and tests |
| `evals/lib/legacy-diff.ts` | Retain for the existing commands and tests |
| `evals/lib/metrics.ts` | Retain for the existing commands and tests |
| `evals/lib/report.ts` | Compare with native DeepEval detail report; retain trial statistics |
| `evals/lib/revision.ts` | Retain for the existing commands and tests |
| `evals/lib/runner.ts` | Retain for the existing commands and tests |
| `evals/lib/trace.ts` | Retain for the existing commands and tests |
| `evals/lib/types.ts` | Retain for the existing commands and tests |
| `evals/lib/workspace.ts` | Retain for the existing commands and tests |
| `evals/regrade.ts` | Retain for the existing commands and tests |
| `evals/reports/2026-11-16/README.md` | Preserve historical publication |
| `evals/reports/2026-11-16/accuracy-vs-cost.png` | Preserve historical publication |
| `evals/reports/2026-11-16/accuracy-vs-cost.svg` | Preserve historical publication |
| `evals/reports/2026-11-16/instructions-vs-docs-mcp.png` | Preserve historical publication |
| `evals/reports/2026-11-16/instructions-vs-docs-mcp.svg` | Preserve historical publication |
| `evals/run.ts` | Retain for the existing commands and tests |
| `evals/tasks/dont-act-jwt-alg-none/hidden/alg-none.test.ts` | Baseline; migration deferred |
| `evals/tasks/dont-act-jwt-alg-none/task.ts` | Baseline; migration deferred |
| `evals/tasks/dont-act-password-recovery/hidden/password-recovery.test.ts` | Baseline; migration deferred |
| `evals/tasks/dont-act-password-recovery/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-admin-api-key/hidden/admin-key.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-admin-api-key/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-body-limit/hidden/body-limit.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-body-limit/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-cors-credentials/hidden/cors-credentials.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-cors-credentials/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-jwt-scopes/hidden/jwt-scopes.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-jwt-scopes/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-rate-limit-healthz/hidden/rate-limit.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-rate-limit-healthz/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-ssrf-import/hidden/ssrf-import.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-ssrf-import/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-staging-docs/hidden/staging-docs.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-staging-docs/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-strict-extra-field/hidden/strict-body.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-strict-extra-field/task.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-webhook-signature/hidden/webhook.test.ts` | Baseline; migration deferred |
| `evals/tasks/guardrail-webhook-signature/task.ts` | Baseline; migration deferred |
| `evals/tasks/helpers.ts` | Baseline; migration deferred |
| `evals/tasks/index.ts` | Baseline; migration deferred |
| `evals/tasks/migration-express-notes/hidden/notes-parity.test.ts` | Baseline; migration deferred |
| `evals/tasks/migration-express-notes/task.ts` | Baseline; migration deferred |
| `evals/tasks/scaffold-books-list/hidden/list-books.test.ts` | Pilot; revise default-limit calibration after replay |
| `evals/tasks/scaffold-books-list/task.ts` | Pilot; revise default-limit calibration after replay |
| `evals/tasks/scaffold-tenant-notes/hidden/tenant-notes.test.ts` | Baseline; migration deferred |
| `evals/tasks/scaffold-tenant-notes/task.ts` | Baseline; migration deferred |
| `evals/tasks/scaffold-users-crud/hidden/users.test.ts` | Baseline; migration deferred |
| `evals/tasks/scaffold-users-crud/task.ts` | Baseline; migration deferred |
| `evals/tsconfig.json` | Retain for the existing commands and tests |
