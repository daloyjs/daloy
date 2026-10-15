// Deno runner for the cross-runtime smoke suite (see ./shared.mjs).
// deno run --allow-net=127.0.0.1 --allow-read=. --allow-env scripts/runtime-smoke/deno.mjs
import * as core from "../../dist/index.js";
import { serve } from "../../dist/adapters/deno.js";
import { buildSmokeApp, runChecks } from "./shared.mjs";

const app = buildSmokeApp(core);
const { promise: listening, resolve } = Promise.withResolvers();
const server = serve(app, {
  port: 0,
  hostname: "127.0.0.1",
  handleSignals: false,
  onListen: ({ port }) => resolve(port),
});

let failed = false;
try {
  const port = await listening;
  const passed = await runChecks(`http://127.0.0.1:${port}`, {
    peer: "socket",
  });
  console.log(
    `deno ${Deno.version.deno}: ${passed.length} checks passed (${passed.join(", ")})`,
  );
} catch (err) {
  failed = true;
  console.error(`deno ${Deno.version.deno}: smoke check failed:`, err);
} finally {
  await server.shutdown();
}
if (failed) Deno.exit(1);
