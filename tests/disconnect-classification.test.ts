import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App, idempotency, _resetSharedIdempotencyStoresForTests } from "../src/index.js";

// A client disconnect is classified as `disconnectStatusCode` (default 499).
// Two guards keep that classification from being abused or from corrupting
// state:
// - only a failure caused by the abort is logged quietly at `info`; any other
//   error thrown after the hang-up is still logged at `error` with its stack,
//   so a client cannot hide a real fault by disconnecting first;
// - idempotency never stores the synthesized 499, so the client's retry with
//   the same key runs the handler instead of replaying an empty response.

type Line = { level: "info" | "warn" | "error"; fields: Record<string, unknown> };

function capturingLogger(lines: Line[]): any {
  const logger: any = {
    info: (fields: Record<string, unknown>) => lines.push({ level: "info", fields }),
    warn: (fields: Record<string, unknown>) => lines.push({ level: "warn", fields }),
    error: (fields: Record<string, unknown>) => lines.push({ level: "error", fields }),
    debug: () => {},
    child: () => logger,
  };
  return logger;
}

/** App whose handler waits for the abort, then throws what `makeError` returns. */
function appThrowingOnAbort(lines: Line[], makeError: (signal: AbortSignal) => unknown) {
  const app = new App({ env: "development", logger: capturingLogger(lines) });
  app.route({
    method: "GET",
    path: "/work",
    responses: { 200: { description: "ok" } },
    handler: async ({ request }) => {
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) return resolve();
        request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw makeError(request.signal);
    },
  });
  return app;
}

async function abortedFetch(app: App): Promise<Response> {
  const controller = new AbortController();
  const pending = app.fetch(new Request("http://x/work", { signal: controller.signal }));
  controller.abort();
  return pending;
}

const disconnectLines = (lines: Line[]) =>
  lines.filter((l) => l.fields.event === "request.disconnected");

test("disconnect: rethrowing the signal's own reason is a quiet 499 at info", async () => {
  const lines: Line[] = [];
  const res = await abortedFetch(appThrowingOnAbort(lines, (signal) => signal.reason));
  assert.equal(res.status, 499);
  const [line] = disconnectLines(lines);
  assert.equal(line?.level, "info");
  assert.equal(line?.fields.err, undefined, "an expected abort carries no error payload");
  assert.equal(lines.filter((l) => l.level === "error").length, 0);
});

test("disconnect: an SDK error wrapping an AbortError in its cause chain is a quiet 499", async () => {
  const lines: Line[] = [];
  const res = await abortedFetch(
    appThrowingOnAbort(lines, () => new Error("request failed", { cause: new DOMException("x", "AbortError") }))
  );
  assert.equal(res.status, 499);
  assert.equal(disconnectLines(lines)[0]?.level, "info");
});

test("[unhappy] disconnect: an unrelated error after the hang-up is still logged at error with its stack", async () => {
  const lines: Line[] = [];
  const res = await abortedFetch(
    appThrowingOnAbort(lines, () => new TypeError("Cannot read properties of undefined (reading 'id')"))
  );
  assert.equal(res.status, 499, "the documented disconnect status is kept");
  const [line] = disconnectLines(lines);
  assert.equal(line?.level, "error", "a real fault must not be downgraded to info by a disconnect");
  const err = line?.fields.err as { name?: string; message?: string; stack?: string } | undefined;
  assert.equal(err?.name, "TypeError");
  assert.match(err?.message ?? "", /reading 'id'/);
  assert.ok(err?.stack, "the stack trace must reach the logs");
});

test("[unhappy] disconnect: an upstream TimeoutError is not mistaken for the client's abort", async () => {
  const lines: Line[] = [];
  await abortedFetch(
    appThrowingOnAbort(lines, () => new DOMException("upstream took too long", "TimeoutError"))
  );
  assert.equal(disconnectLines(lines)[0]?.level, "error");
});

test("[unhappy] disconnect: a plain Error thrown on abort keeps 499 but is logged with its details", async () => {
  // Hand-written handlers often turn the abort into `new Error("aborted")`.
  // The status contract is unchanged; the error is simply no longer dropped.
  const lines: Line[] = [];
  const res = await abortedFetch(appThrowingOnAbort(lines, () => new Error("aborted")));
  assert.equal(res.status, 499);
  const [line] = disconnectLines(lines);
  assert.equal(line?.level, "error");
  assert.equal((line?.fields.err as { message?: string }).message, "aborted");
});

test("[unhappy] disconnect: idempotency releases the key so the retry runs the handler", async () => {
  _resetSharedIdempotencyStoresForTests();
  const app = new App({ env: "development", logger: false });
  app.use(idempotency({ allowUnscopedCallers: true }));
  let calls = 0;
  let hangUp = true;
  app.route({
    method: "POST",
    path: "/pay",
    request: { body: z.object({ amount: z.number() }) },
    responses: { 201: { description: "created", body: z.object({ id: z.number() }) } },
    handler: async ({ request }) => {
      calls++;
      if (hangUp) {
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) return resolve();
          request.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        throw request.signal.reason;
      }
      return { status: 201 as const, body: { id: calls } };
    },
  });
  const init = (signal?: AbortSignal): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "pay-1" },
    body: JSON.stringify({ amount: 10 }),
    ...(signal ? { signal } : {}),
  });

  const controller = new AbortController();
  const pending = app.fetch(new Request("http://x/pay", init(controller.signal)));
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();
  assert.equal((await pending).status, 499);

  hangUp = false;
  const retry = await app.fetch(new Request("http://x/pay", init()));
  assert.equal(retry.status, 201, "the retry must run, not replay the empty 499");
  assert.deepEqual(await retry.json(), { id: 2 });
  assert.equal(calls, 2);

  const replay = await app.fetch(new Request("http://x/pay", init()));
  assert.equal(replay.status, 201, "the successful retry is what gets stored and replayed");
  assert.equal(calls, 2, "a completed key still replays without re-running the handler");
});
