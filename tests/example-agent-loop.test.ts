import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  buildAgentLoopApp,
  type AgentLoopOptions,
  type AuditEvent,
  type ModelTurn,
} from "../examples/agent-loop.ts";

// Runs the "host an agent loop on DaloyJS" tutorial example end to end, so
// the code the docs show is the code CI executes.

type Event = { event: string; data: any };

function parseSse(text: string): Event[] {
  return text
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6))
        .join("\n");
      return { event, data: data ? JSON.parse(data) : undefined };
    });
}

function setup(script: ModelTurn[], overrides: Partial<AgentLoopOptions> = {}) {
  const audit: AuditEvent[] = [];
  const refunds: string[] = [];
  const seen: string[][] = [];
  const app = buildAgentLoopApp({
    model: async (history) => {
      seen.push(history.map((h) => `${h.role}:${h.content}`));
      return script.shift() ?? { type: "text", text: "Done." };
    },
    tools: {
      lookupOrder: {
        description: "Read an order",
        input: z.object({ orderId: z.string() }).strict(),
        run: ({ orderId }) => ({ orderId, total: 42 }),
      },
      refundOrder: {
        description: "Refund an order",
        input: z.object({ orderId: z.string() }).strict(),
        risky: true,
        run: ({ orderId }) => {
          refunds.push(orderId);
          return { orderId, refunded: true };
        },
      },
      explode: {
        description: "Always fails",
        input: z.object({}).strict(),
        run: () => {
          throw new Error("db password leaked in stack");
        },
      },
    },
    approvalSecret: new Uint8Array(32).fill(7),
    users: { "alice-token": "alice", "bob-token": "bob" },
    onAudit: (e) => audit.push(e),
    ...overrides,
  });
  const call = (path: string, token: string, body?: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const newSession = async (token = "alice-token") =>
    ((await (await call("/sessions", token)).json()) as { id: string }).id;
  const say = async (id: string, text: string, token = "alice-token") => {
    const res = await call(`/sessions/${id}/messages`, token, { text });
    return { status: res.status, events: res.status === 200 ? parseSse(await res.text()) : [] };
  };
  const decide = async (id: string, approvalToken: string, approve: boolean, token = "alice-token") => {
    const res = await call(`/sessions/${id}/approvals`, token, { approvalToken, approve });
    return { status: res.status, events: res.status === 200 ? parseSse(await res.text()) : [] };
  };
  return { app, audit, refunds, seen, call, newSession, say, decide };
}

const names = (events: Event[]) => events.map((e) => e.event);

describe("agent loop example", () => {
  test("a plain answer streams and finishes", async () => {
    const t = setup([{ type: "text", text: "Hello!" }]);
    const { status, events } = await t.say(await t.newSession(), "hi");
    assert.equal(status, 200);
    assert.deepEqual(names(events), ["assistant", "done"]);
    assert.equal(events[0]!.data.text, "Hello!");
  });

  test("safe tools run immediately and their result reaches the model", async () => {
    const t = setup([
      { type: "tool", name: "lookupOrder", input: { orderId: "A-1" } },
      { type: "text", text: "Order A-1 costs 42." },
    ]);
    const { events } = await t.say(await t.newSession(), "how much is A-1?");
    assert.deepEqual(names(events), ["tool_result", "assistant", "done"]);
    assert.deepEqual(events[0]!.data.output, { orderId: "A-1", total: 42 });
    assert.ok(t.seen[1]!.some((line) => line.startsWith("tool:") && line.includes('"total":42')));
    assert.deepEqual(t.audit.map((a) => a.type), ["tool_call"]);
  });

  test("a risky tool pauses for approval and runs only after it", async () => {
    const t = setup([
      { type: "tool", name: "refundOrder", input: { orderId: "A-1" } },
      { type: "text", text: "Refunded." },
    ]);
    const id = await t.newSession();
    const first = await t.say(id, "refund A-1");
    assert.deepEqual(names(first.events), ["approval_required"]);
    assert.equal(t.refunds.length, 0, "nothing risky runs before approval");
    const token = first.events[0]!.data.approvalToken as string;
    const resumed = await t.decide(id, token, true);
    assert.equal(resumed.status, 200);
    assert.deepEqual(names(resumed.events), ["tool_result", "assistant", "done"]);
    assert.deepEqual(t.refunds, ["A-1"]);
    assert.deepEqual(t.audit.map((a) => a.type), ["approval_requested", "approval_granted", "tool_call"]);
  });

  test("a denial never runs the tool and tells the model", async () => {
    const t = setup([
      { type: "tool", name: "refundOrder", input: { orderId: "A-1" } },
      { type: "text", text: "Okay, no refund." },
    ]);
    const id = await t.newSession();
    const token = (await t.say(id, "refund A-1")).events[0]!.data.approvalToken as string;
    const resumed = await t.decide(id, token, false);
    assert.deepEqual(names(resumed.events), ["approval_denied", "assistant", "done"]);
    assert.equal(t.refunds.length, 0);
    assert.ok(t.seen.at(-1)!.includes("tool:The user denied this action."));
  });

  test("approval tokens are single-use and bound to user, session, and tool call", async () => {
    const t = setup([
      { type: "tool", name: "refundOrder", input: { orderId: "A-1" } },
      { type: "tool", name: "refundOrder", input: { orderId: "B-2" } },
    ]);
    const a = await t.newSession();
    const b = await t.newSession();
    const tokenA = (await t.say(a, "refund A-1")).events[0]!.data.approvalToken as string;
    await t.say(b, "refund B-2");
    // Wrong session: a valid token for A cannot approve B's pending call.
    assert.equal((await t.decide(b, tokenA, true)).status, 403);
    // Tampered and foreign-secret tokens are refused.
    assert.equal((await t.decide(a, tokenA.slice(0, -2) + "xx", true)).status, 403);
    const forger = setup([{ type: "tool", name: "refundOrder", input: { orderId: "A-1" } }], {
      approvalSecret: new Uint8Array(32).fill(9),
    });
    const forged = (await forger.say(await forger.newSession(), "x")).events[0]!.data.approvalToken as string;
    assert.equal((await t.decide(a, forged, true)).status, 403);
    // Another user cannot even see the session.
    assert.equal((await t.decide(a, tokenA, true, "bob-token")).status, 404);
    assert.equal(t.refunds.length, 0, "no refused attempt ran the tool");
    // The right token works once; a replay finds nothing pending.
    assert.equal((await t.decide(a, tokenA, true)).status, 200);
    assert.equal((await t.decide(a, tokenA, true)).status, 409);
    assert.deepEqual(t.refunds, ["A-1"]);
  });

  test("the step budget stops a runaway loop", async () => {
    const forever: ModelTurn[] = Array.from({ length: 50 }, () => ({
      type: "tool" as const,
      name: "lookupOrder",
      input: { orderId: "A-1" },
    }));
    const t = setup(forever, { maxSteps: 3 });
    const { events } = await t.say(await t.newSession(), "loop");
    assert.deepEqual(names(events), ["tool_result", "tool_result", "tool_result", "budget_exhausted"]);
    assert.equal(events.at(-1)!.data.maxSteps, 3);
  });

  test("bad tool input and unknown tools go back to the model, and tool errors stay generic", async () => {
    const t = setup([
      { type: "tool", name: "lookupOrder", input: { orderId: 5 } },
      { type: "tool", name: "dropTables", input: {} },
      { type: "tool", name: "explode", input: {} },
      { type: "text", text: "Sorry." },
    ]);
    const { events } = await t.say(await t.newSession(), "go");
    assert.deepEqual(names(events), ["tool_error", "tool_error", "tool_error", "assistant", "done"]);
    assert.equal(events[0]!.data.error, "Invalid tool input.");
    assert.match(events[1]!.data.error, /Unknown tool/);
    assert.doesNotMatch(JSON.stringify(events), /db password/, "internal error text never streams out");
  });

  test("auth, isolation, and the pending-approval guard", async () => {
    const t = setup([{ type: "tool", name: "refundOrder", input: { orderId: "A-1" } }]);
    assert.equal((await t.call("/sessions", "nope")).status, 401);
    const id = await t.newSession();
    assert.equal((await t.say(id, "hi", "bob-token")).status, 404, "bob cannot use alice's session");
    await t.say(id, "refund A-1");
    assert.equal((await t.say(id, "and another thing")).status, 409, "no new message while approval pends");
    assert.equal((await t.decide(await t.newSession(), "x".repeat(20), true)).status, 409);
  });
});
