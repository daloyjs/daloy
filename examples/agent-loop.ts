/**
 * Host an agent loop on DaloyJS: a provider-neutral agent session API.
 *
 * DaloyJS does not run an LLM or an agent loop in core. This example shows how
 * to host YOUR loop on DaloyJS using only existing features:
 *   - SSE streaming of every step (`sseResponse`), aborted with the request.
 *   - Human approval for risky tools: the loop pauses and returns a signed,
 *     short-lived, single-use approval token bound to user + session + tool
 *     call (`createJwtSigner`). Resuming requires that exact token.
 *   - A step budget, so a runaway loop stops.
 *   - Tool input validated against a Zod schema before any tool runs.
 *   - Per-user rate limiting and owner-scoped sessions (no cross-user access).
 *   - An audit hook for every tool call and approval decision.
 *
 * The model is a plain function, so any provider fits: call your LLM SDK
 * inside `model(history, signal)` and map its reply to a `ModelTurn`.
 *
 * Run:  node --import tsx examples/agent-loop.ts
 */

import { z } from "zod";
import {
  App,
  createJwtSigner,
  createJwtVerifier,
  markAuthHook,
  NotFoundError,
  rateLimit,
  sseResponse,
  timingSafeEqual,
  type SSEMessage,
} from "../src/index.ts";

/** One entry in the conversation the model sees. */
export interface HistoryItem {
  role: "user" | "assistant" | "tool";
  content: string;
  tool?: string;
}

/** What the model decided to do next. */
export type ModelTurn =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown };

/** Your LLM call. Receives the history and the request's abort signal. */
export type Model = (history: readonly HistoryItem[], signal: AbortSignal) => Promise<ModelTurn>;

/** A tool the model may call. `risky` tools need a human approval first. */
export interface AgentTool<I = unknown> {
  description: string;
  input: z.ZodType<I>;
  risky?: boolean;
  run(input: I, ctx: { user: string; signal: AbortSignal }): unknown | Promise<unknown>;
}

/** Audit record for every tool call and approval decision. */
export interface AuditEvent {
  type: "tool_call" | "tool_error" | "approval_requested" | "approval_granted" | "approval_denied";
  user: string;
  sessionId: string;
  tool: string;
  toolCallId: string;
}

export interface AgentLoopOptions {
  model: Model;
  tools: Record<string, AgentTool<any>>;
  /** At least 32 random bytes; signs approval tokens. Load it from a secret manager. */
  approvalSecret: Uint8Array;
  /** Bearer token -> user id. Replace with your real auth (e.g. `jwk()`). */
  users: Record<string, string>;
  /** Model calls allowed per message before the loop stops. Default 8. */
  maxSteps?: number;
  /** Approval token lifetime in seconds. Default 600. */
  approvalTtlSeconds?: number;
  /** Receives every audit event. Send these to your audit store. */
  onAudit?: (event: AuditEvent) => void;
}

interface Session {
  id: string;
  owner: string;
  history: HistoryItem[];
  pending?: { toolCallId: string; name: string; input: unknown };
}

export function buildAgentLoopApp(options: AgentLoopOptions) {
  const maxSteps = options.maxSteps ?? 8;
  const ttl = options.approvalTtlSeconds ?? 600;
  const audit = options.onAudit ?? (() => {});
  const signer = createJwtSigner({ alg: "HS256", key: options.approvalSecret, maxLifetimeSeconds: ttl });
  const verifier = createJwtVerifier({ algorithms: ["HS256"], key: options.approvalSecret, maxLifetimeSeconds: ttl });
  const sessions = new Map<string, Session>();
  // JSON keys: an unambiguous (owner, id) pair, so no owner can reach another's session.
  const keyOf = (owner: string, id: string) => JSON.stringify([owner, id]);

  const app = new App({ logger: false });

  // Toy bearer auth that records the user. Use jwk() / your IdP in production.
  app.use(
    markAuthHook({
      async preBody(ctx) {
        const header = ctx.request.headers.get("authorization") ?? "";
        const token = /^Bearer (.+)$/.exec(header)?.[1];
        let user: string | undefined;
        for (const [known, id] of Object.entries(options.users)) {
          if (token !== undefined && timingSafeEqual(token, known)) user = id;
        }
        if (user === undefined) return new Response(null, { status: 401 });
        (ctx.state as Record<string, unknown>).user = user;
        return undefined;
      },
    })
  );
  // Per-user budget on how often a client may drive the loop.
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 30,
      keyGenerator: (ctx) => `user:${String((ctx.state as Record<string, unknown>).user)}`,
    })
  );

  const userOf = (state: unknown) => (state as { user: string }).user;
  const sessionFor = (owner: string, id: string): Session => {
    const session = sessions.get(keyOf(owner, id));
    // Same answer for "missing" and "someone else's": do not reveal it exists.
    if (!session) throw new NotFoundError("Session not found");
    return session;
  };

  async function* execute(session: Session, name: string, input: unknown, toolCallId: string, signal: AbortSignal) {
    const tool = options.tools[name]!;
    audit({ type: "tool_call", user: session.owner, sessionId: session.id, tool: name, toolCallId });
    try {
      const output = await tool.run(input, { user: session.owner, signal });
      session.history.push({ role: "tool", tool: name, content: JSON.stringify(output ?? null) });
      yield { event: "tool_result", data: { toolCallId, tool: name, output } } satisfies SSEMessage;
    } catch {
      audit({ type: "tool_error", user: session.owner, sessionId: session.id, tool: name, toolCallId });
      session.history.push({ role: "tool", tool: name, content: "The tool failed." });
      yield { event: "tool_error", data: { toolCallId, tool: name, error: "The tool failed." } } satisfies SSEMessage;
    }
  }

  async function* loop(session: Session, signal: AbortSignal): AsyncGenerator<SSEMessage> {
    for (let step = 0; step < maxSteps; step++) {
      if (signal.aborted) return;
      const turn = await options.model(session.history, signal);
      if (turn.type === "text") {
        session.history.push({ role: "assistant", content: turn.text });
        yield { event: "assistant", data: { text: turn.text } };
        yield { event: "done", data: {} };
        return;
      }
      const tool = options.tools[turn.name];
      const parsed = tool?.input.safeParse(turn.input);
      if (!tool || !parsed?.success) {
        // Unknown tool or bad input: tell the model and let it try again.
        const error = !tool ? `Unknown tool "${turn.name}".` : "Invalid tool input.";
        session.history.push({ role: "tool", tool: turn.name, content: error });
        yield { event: "tool_error", data: { tool: turn.name, error } };
        continue;
      }
      const toolCallId = crypto.randomUUID();
      if (tool.risky) {
        session.pending = { toolCallId, name: turn.name, input: parsed.data };
        const now = Math.floor(Date.now() / 1000);
        const approvalToken = await signer.sign({
          sub: session.owner,
          sid: session.id,
          tcid: toolCallId,
          iat: now,
          exp: now + ttl,
        });
        audit({ type: "approval_requested", user: session.owner, sessionId: session.id, tool: turn.name, toolCallId });
        // Pause: nothing risky runs until a human sends this token back.
        yield { event: "approval_required", data: { toolCallId, tool: turn.name, input: parsed.data, approvalToken } };
        return;
      }
      yield* execute(session, turn.name, parsed.data, toolCallId, signal);
    }
    yield { event: "budget_exhausted", data: { maxSteps } };
  }

  app.post(
    "/sessions",
    {
      operationId: "createSession",
      responses: { 201: { description: "Created", body: z.object({ id: z.string() }) } },
    },
    ({ state }) => {
      const id = crypto.randomUUID();
      const owner = userOf(state);
      sessions.set(keyOf(owner, id), { id, owner, history: [] });
      return { status: 201 as const, body: { id } };
    }
  );

  app.post(
    "/sessions/:id/messages",
    {
      operationId: "sendSessionMessage",
      request: {
        params: z.object({ id: z.string().min(1) }).strict(),
        body: z.object({ text: z.string().min(1).max(8_000) }).strict(),
      },
      acknowledgeNoResponseBodySchema: true,
      responses: {
        200: { description: "Server-sent events for each loop step" },
        404: { description: "Session not found" },
        409: { description: "Waiting for an approval" },
      },
    },
    ({ params, body, state, request }) => {
      const session = sessionFor(userOf(state), params.id);
      if (session.pending) {
        return Response.json({ error: "Waiting for an approval on this session." }, { status: 409 });
      }
      session.history.push({ role: "user", content: body.text });
      return sseResponse(() => loop(session, request.signal), { signal: request.signal });
    }
  );

  app.post(
    "/sessions/:id/approvals",
    {
      operationId: "decideApproval",
      request: {
        params: z.object({ id: z.string().min(1) }).strict(),
        body: z.object({ approvalToken: z.string().min(1).max(4_096), approve: z.boolean() }).strict(),
      },
      acknowledgeNoResponseBodySchema: true,
      responses: {
        200: { description: "Server-sent events for the resumed loop" },
        403: { description: "Invalid, expired, or foreign approval token" },
        404: { description: "Session not found" },
        409: { description: "No approval is pending" },
      },
    },
    async ({ params, body, state, request }) => {
      const owner = userOf(state);
      const session = sessionFor(owner, params.id);
      const pending = session.pending;
      if (!pending) return Response.json({ error: "No approval is pending." }, { status: 409 });
      let claims: Record<string, unknown>;
      try {
        claims = (await verifier.verify(body.approvalToken)).payload;
      } catch {
        return Response.json({ error: "Invalid or expired approval token." }, { status: 403 });
      }
      // Bound to this user, this session, and this exact tool call.
      if (claims.sub !== owner || claims.sid !== session.id || claims.tcid !== pending.toolCallId) {
        return Response.json({ error: "This approval token does not match." }, { status: 403 });
      }
      // Single use: clear it before running, so a replay finds nothing pending.
      session.pending = undefined;
      const decision = body.approve ? "approval_granted" : "approval_denied";
      audit({ type: decision, user: owner, sessionId: session.id, tool: pending.name, toolCallId: pending.toolCallId });
      async function* resume(): AsyncGenerator<SSEMessage> {
        if (body.approve) {
          yield* execute(session, pending!.name, pending!.input, pending!.toolCallId, request.signal);
        } else {
          session.history.push({ role: "tool", tool: pending!.name, content: "The user denied this action." });
          yield { event: "approval_denied", data: { toolCallId: pending!.toolCallId } };
        }
        yield* loop(session, request.signal);
      }
      return sseResponse(resume, { signal: request.signal });
    }
  );

  return app;
}

// Run as a script: a scripted "model" so the demo needs no API key.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { serve } = await import("../src/adapters/node.ts");
  const script: ModelTurn[] = [
    { type: "tool", name: "lookupOrder", input: { orderId: "A-1" } },
    { type: "tool", name: "refundOrder", input: { orderId: "A-1" } },
    { type: "text", text: "Refunded order A-1." },
  ];
  const app = buildAgentLoopApp({
    model: async () => script.shift() ?? { type: "text", text: "Done." },
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
        run: ({ orderId }) => ({ orderId, refunded: true }),
      },
    },
    approvalSecret: crypto.getRandomValues(new Uint8Array(32)),
    users: { "dev-token": "alice" },
    onAudit: (event) => console.log("[audit]", JSON.stringify(event)),
  });
  serve(app, { port: 3000 });
  console.log("Agent loop on http://localhost:3000 (Authorization: Bearer dev-token)");
}
