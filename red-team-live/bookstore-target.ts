/**
 * BOOKSTORE LIVE TARGET — the shipped example app (`examples/build-app.ts`)
 * bound to loopback only, attacked by `skill-wave2-attacks.ts`.
 *
 * This is what a `create-daloy` user actually deploys (secureHeaders, cors,
 * rateLimit, bearerAuth on POST /books). The process does **not** force
 * `NODE_ENV=production`: `cors({ origin: "*" })` in the shipped example
 * refuses to boot under production secure-defaults (that refuse-to-boot is
 * probed separately). Port 0 + `hostname: "127.0.0.1"` so the engagement
 * never listens on the LAN.
 *
 * Handshake: prints `BOOKSTORE_TARGET_READY <port>`.
 */

import { serve } from "../src/adapters/node.ts";
import { buildExampleApp } from "../examples/build-app.ts";

const app = buildExampleApp();
const handle = serve(app, { port: 0, hostname: "127.0.0.1" });
handle.server.on("listening", () => {
  console.log(`BOOKSTORE_TARGET_READY ${handle.port}`);
});

const shutdown = async (): Promise<void> => {
  await handle.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
