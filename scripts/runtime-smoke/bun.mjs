// Bun runner for the cross-runtime smoke suite (see ./shared.mjs).
// bun scripts/runtime-smoke/bun.mjs
import * as core from "../../dist/index.js";
import { serve } from "../../dist/adapters/bun.js";
import { buildSmokeApp, runChecks } from "./shared.mjs";

const app = buildSmokeApp(core);
const server = serve(app, {
  port: 0,
  hostname: "127.0.0.1",
  handleSignals: false,
});

let failed = false;
try {
  const passed = await runChecks(`http://127.0.0.1:${server.port}`, {
    peer: "socket",
  });
  console.log(
    `bun ${Bun.version}: ${passed.length} checks passed (${passed.join(", ")})`,
  );
} catch (err) {
  failed = true;
  console.error(`bun ${Bun.version}: smoke check failed:`, err);
} finally {
  await server.stop();
}
process.exit(failed ? 1 : 0);
