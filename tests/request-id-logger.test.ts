/**
 * The per-request logger and the `x-request-id` header must carry the same id.
 * The logger was bound to the framework's id before hooks ran, and
 * `requestId()` then generated a second id for the header, so log lines and
 * the header disagreed. `requestId()` now keeps the framework's id unless it
 * trusts an incoming header or has a custom generator, and the framework
 * rebinds the logger whenever a hook really changes the id.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App, HttpError, requestId } from "../src/index.js";

type Line = { level: string; bindings: Record<string, unknown>; obj: unknown };

function captureLogger() {
  const lines: Line[] = [];
  const make = (bindings: Record<string, unknown>): any => {
    const at = (level: string) => (obj: unknown) => lines.push({ level, bindings, obj });
    return {
      trace: at("trace"),
      debug: at("debug"),
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
      fatal: at("fatal"),
      child: (extra: Record<string, unknown>) => make({ ...bindings, ...extra }),
    };
  };
  return { logger: make({}), lines };
}

function app(hooks: Parameters<App["use"]>[0]) {
  const { logger, lines } = captureLogger();
  const a = new App({ logger });
  a.use(hooks);
  a.route({
    method: "GET",
    path: "/fail",
    responses: { 200: { description: "ok" } },
    handler: () => {
      throw new HttpError(503, { title: "down" });
    },
  });
  a.route({
    method: "GET",
    path: "/log",
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "ok" } },
    handler: (ctx: { state: { log: { info(o: unknown): void } } }) => {
      ctx.state.log.info({ from: "handler" });
      return { status: 200 as const, body: undefined };
    },
  } as never);
  return { app: a, lines };
}

// Request-scoped lines only; App-level boot lines have no request bound.
const idsIn = (lines: Line[]) => {
  const scoped = lines.filter((l) => "method" in l.bindings);
  assert.ok(scoped.length > 0, "at least one request-scoped log line");
  return new Set(scoped.map((l) => l.bindings.requestId));
};

test("[request-id] default requestId(): header and framework log lines share one id", async () => {
  const { app: a, lines } = app(requestId());
  const res = await a.fetch(new Request("http://x/fail"));
  const header = res.headers.get("x-request-id");
  assert.ok(header);
  assert.ok(lines.length > 0, "the 503 is logged");
  assert.deepEqual(idsIn(lines), new Set([header]));
});

test("[request-id] a custom generator rebinds ctx.state.log to the new id", async () => {
  const { app: a, lines } = app(requestId({ generator: () => "custom-id-1" }));
  const res = await a.fetch(new Request("http://x/log"));
  assert.equal(res.headers.get("x-request-id"), "custom-id-1");
  assert.deepEqual(idsIn(lines), new Set(["custom-id-1"]));
});

test("[request-id] a trusted incoming id is used by the header and the logger", async () => {
  const { app: a, lines } = app(requestId({ trustIncoming: true }));
  const res = await a.fetch(new Request("http://x/fail", { headers: { "x-request-id": "edge-abc.123" } }));
  assert.equal(res.headers.get("x-request-id"), "edge-abc.123");
  assert.deepEqual(idsIn(lines), new Set(["edge-abc.123"]));
});

test("[request-id] an invalid incoming id is still refused, and header and logger stay aligned", async () => {
  const { app: a, lines } = app(requestId({ trustIncoming: true }));
  const res = await a.fetch(
    new Request("http://x/fail", { headers: { "x-request-id": "bad id with spaces" } }),
  );
  const header = res.headers.get("x-request-id");
  assert.ok(header && header !== "bad id with spaces");
  assert.deepEqual(idsIn(lines), new Set([header]));
});

test("[request-id] an untrusted incoming id is ignored", async () => {
  const { app: a } = app(requestId());
  const res = await a.fetch(new Request("http://x/log", { headers: { "x-request-id": "spoofed" } }));
  assert.notEqual(res.headers.get("x-request-id"), "spoofed");
});
