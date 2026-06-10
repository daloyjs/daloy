/**
 * Long-running entry point used by `.github/workflows/dast.yml` to give
 * an OWASP ZAP baseline scan something to probe.
 *
 * Unlike `examples/basic.ts` (which auto-closes after a single client
 * smoke call), this script boots the bookstore example app and stays
 * alive until it receives `SIGTERM` / `SIGINT` from the workflow. The
 * surface ZAP scans is exactly the same App configuration the framework
 * ships in `examples/build-app.ts`, so the dynamic scan exercises the
 * real `secureHeaders()`, `cors()`, `rateLimit()`, body-cap, header
 * sanitization, and router path-traversal defenses end-to-end against
 * a running server.
 *
 * Closes the DAST half of the Aikido "SAST vs DAST" guidance
 * (https://www.aikido.dev/blog/sast-vs-dast-what-you-need-to-now)
 * and the OpenAPI-guided-DAST half of the Aikido "API security
 * testing" guidance
 * (https://www.aikido.dev/blog/api-security-testing): SAST is
 * covered by CodeQL + zizmor + the ~20 first-party `verify:*` gates;
 * this entry point is what makes a real DAST scan (both the passive
 * `zap-baseline.py` pass and the OpenAPI-fed active `zap-api-scan.py`
 * pass wired up in `.github/workflows/dast.yml`) possible in CI
 * without needing a deployed endpoint.
 */

import { serve } from "../src/adapters/node.ts";
import { buildExampleApp } from "./build-app.ts";

const app = buildExampleApp();
const port = Number(process.env.PORT ?? 3000);

const { close } = serve(app, { port });

// eslint-disable-next-line no-console
console.log(`DAST target ready at http://localhost:${port}`);

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, draining…`);
  await close();
  process.exit(0);
};

process.on("SIGTERM", (sig) => void shutdown(sig));
process.on("SIGINT", (sig) => void shutdown(sig));
