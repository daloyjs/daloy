import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { SequenceDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Tutorial: host an agent loop on DaloyJS",
  description:
    "Host your own LLM agent loop on DaloyJS without putting an LLM in the framework: stream each step over SSE, pause risky tools for a signed human approval, cap the steps, validate tool input, and audit every tool call.",
  path: "/docs/tutorials/agent-loop",
  keywords: [
    "agent loop TypeScript",
    "host an AI agent backend",
    "human in the loop approval",
    "tool call approval",
    "agent SSE streaming",
    "agentic harness backend",
    "DaloyJS agents",
    "LLM tool calling API",
  ],
  type: "article",
});

const MODEL = `// Your LLM call. Any provider fits: call its SDK here and map the reply.
export type ModelTurn =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown };

export type Model = (history: readonly HistoryItem[], signal: AbortSignal) => Promise<ModelTurn>;

// A tool the model may call. Risky tools need a human approval first.
export interface AgentTool<I = unknown> {
  description: string;
  input: z.ZodType<I>;
  risky?: boolean;
  run(input: I, ctx: { user: string; signal: AbortSignal }): unknown | Promise<unknown>;
}`;

const LOOP = `async function* loop(session: Session, signal: AbortSignal): AsyncGenerator<SSEMessage> {
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
      const error = !tool ? \`Unknown tool "\${turn.name}".\` : "Invalid tool input.";
      session.history.push({ role: "tool", tool: turn.name, content: error });
      yield { event: "tool_error", data: { tool: turn.name, error } };
      continue;
    }
    const toolCallId = crypto.randomUUID();
    if (tool.risky) {
      // ...sign an approval token and pause (next section).
    }
    yield* execute(session, turn.name, parsed.data, toolCallId, signal);
  }
  yield { event: "budget_exhausted", data: { maxSteps } };
}`;

const ROUTE = `app.post(
  "/sessions/:id/messages",
  {
    operationId: "sendSessionMessage",
    request: {
      params: z.object({ id: z.string().min(1) }).strict(),
      body: z.object({ text: z.string().min(1).max(8_000) }).strict(),
    },
    acknowledgeNoResponseBodySchema: true,
    responses: { 200: { description: "Server-sent events for each loop step" } },
  },
  ({ params, body, state, request }) => {
    const session = sessionFor(userOf(state), params.id); // 404 if not yours
    if (session.pending) {
      return Response.json({ error: "Waiting for an approval on this session." }, { status: 409 });
    }
    session.history.push({ role: "user", content: body.text });
    return sseResponse(() => loop(session, request.signal), { signal: request.signal });
  }
);`;

const PAUSE = `if (tool.risky) {
  session.pending = { toolCallId, name: turn.name, input: parsed.data };
  const now = Math.floor(Date.now() / 1000);
  const approvalToken = await signer.sign({
    sub: session.owner, // this user
    sid: session.id,    // this session
    tcid: toolCallId,   // this exact tool call
    iat: now,
    exp: now + ttl,     // short-lived
  });
  audit({ type: "approval_requested", user: session.owner, sessionId: session.id, tool: turn.name, toolCallId });
  // Pause: nothing risky runs until a human sends this token back.
  yield { event: "approval_required", data: { toolCallId, tool: turn.name, input: parsed.data, approvalToken } };
  return;
}`;

const RESUME = `let claims: Record<string, unknown>;
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
session.pending = undefined;`;

const GUARDS = `app.use(markAuthHook({ /* your real auth, e.g. jwk() */ }));
// Per-user budget on how often a client may drive the loop.
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 30,
    keyGenerator: (ctx) => \`user:\${String((ctx.state as Record<string, unknown>).user)}\`,
  })
);`;

const WIRE = `POST /sessions/3f0e.../messages
{ "text": "refund order A-1" }

event: tool_result
data: {"toolCallId":"...","tool":"lookupOrder","output":{"orderId":"A-1","total":42}}

event: approval_required
data: {"toolCallId":"9b1c...","tool":"refundOrder","input":{"orderId":"A-1"},"approvalToken":"eyJ..."}

POST /sessions/3f0e.../approvals
{ "approvalToken": "eyJ...", "approve": true }

event: tool_result
data: {"toolCallId":"9b1c...","tool":"refundOrder","output":{"orderId":"A-1","refunded":true}}

event: assistant
data: {"text":"Refunded order A-1."}

event: done
data: {}`;

export default function Page() {
  return (
    <>
      <h1>Tutorial: host an agent loop on DaloyJS</h1>
      <p>
        DaloyJS does not run an LLM or an agent loop in core, on purpose. The
        loop is where your prompts, your model provider, and your memory live,
        and that belongs to you or to an agent framework. What DaloyJS is good
        at is everything around the loop that is easy to get wrong: streaming,
        auth, rate limits, validation, signed state, and audit trails.
      </p>
      <p>
        We will host a small agent session API: the model calls tools, safe
        tools run straight away, risky tools pause for a human, and every step
        streams to the client. The complete, tested code is{" "}
        <code>examples/agent-loop.ts</code> in the DaloyJS repository. Its test
        suite runs this exact code, including the attacks.
      </p>

      <SequenceDiagram
        title="A risky tool call with human approval"
        participants={["Client", "DaloyJS", "Your model"]}
        steps={[
          { from: "Client", to: "DaloyJS", label: "POST /sessions/:id/messages", detail: '"refund order A-1"', kind: "request" },
          { from: "DaloyJS", to: "Your model", label: "model(history, signal)", detail: "wants refundOrder", kind: "request" },
          { from: "DaloyJS", to: "Client", label: "event: approval_required", detail: "signed, single-use approvalToken", kind: "response" },
          { from: "Client", to: "Client", label: "A human reviews the action", kind: "note" },
          { from: "Client", to: "DaloyJS", label: "POST /sessions/:id/approvals", detail: "{ approvalToken, approve: true }", kind: "request" },
          { from: "DaloyJS", to: "DaloyJS", label: "Verify: this user, session, tool call", detail: "then clear it (no replay)", kind: "note" },
          { from: "DaloyJS", to: "Client", label: "event: tool_result, assistant, done", kind: "response" },
        ]}
        caption="Nothing risky runs until the exact approval token comes back. A token for another session, another user, or an old call is refused, and a replay finds nothing pending."
      />

      <h2 id="1-model-and-tools">1. The model and the tools</h2>
      <p>
        The model is a plain function, so you are not locked to a provider.
        Call your LLM SDK inside it and map the reply to a{" "}
        <code>ModelTurn</code>. Tools declare a Zod input schema, and{" "}
        <code>risky: true</code> marks the ones a human must approve (refunds,
        deletes, sending email, anything with side effects you would regret).
      </p>
      <CodeBlock code={MODEL} />

      <h2 id="2-the-loop">2. The loop</h2>
      <p>
        The loop is an async generator: each step it yields becomes a
        server-sent event. It stops on a text answer, on a pause for approval,
        when the request is aborted, or when the step budget runs out. A tool
        the model invented, or input that fails the schema, never runs: the
        error goes back into the history so the model can try again.
      </p>
      <CodeBlock code={LOOP} />

      <h2 id="3-stream-it">3. Stream it</h2>
      <p>
        <code>sseResponse</code> turns the generator into a streaming response,
        and passing <code>request.signal</code> stops the loop when the client
        disconnects or the request times out, so you do not keep paying for
        model calls nobody is reading. Sessions are looked up by owner, so
        another user gets <code>404</code>, not someone else&apos;s agent.
      </p>
      <CodeBlock code={ROUTE} />

      <h2 id="4-human-approval">4. Pause for a human</h2>
      <p>
        When the model picks a risky tool, the loop stores the pending call and
        returns an approval token instead of running it. The token is a
        short-lived signed JWT (<code>createJwtSigner</code>) bound to this
        user, this session, and this exact tool call. The server keeps the
        pending input, so the client cannot swap in different arguments while
        approving.
      </p>
      <CodeBlock code={PAUSE} />
      <p>
        Resuming verifies the signature and expiry, checks every binding, and
        clears the pending call before running it, so the same token cannot
        approve twice:
      </p>
      <CodeBlock code={RESUME} />

      <h2 id="5-guardrails">5. Guardrails around the loop</h2>
      <p>
        Put real authentication in front (for example{" "}
        <Link href={"/docs/auth" as Route}>jwk()</Link>), and give each user a
        rate limit on how often they can drive the loop. The step budget
        (<code>maxSteps</code>) caps how many model calls one message can cost.
        Every tool call and approval decision goes to <code>onAudit</code>,
        which is where you connect your audit store.
      </p>
      <CodeBlock code={GUARDS} />
      <p>
        Two more rules the example follows: a failing tool streams a generic
        &quot;The tool failed.&quot; rather than its error text, and a new
        message on a session with a pending approval gets <code>409</code>{" "}
        until the human decides.
      </p>

      <h2 id="6-on-the-wire">6. What the client sees</h2>
      <CodeBlock code={WIRE} language="http" />

      <h2 id="7-tests">7. Test the attacks, not only the happy path</h2>
      <p>The example&apos;s tests prove each guard with a real attempt:</p>
      <ul>
        <li>An approval token for another session is refused.</li>
        <li>A tampered token and a token signed with another secret are refused.</li>
        <li>Another user cannot see the session at all.</li>
        <li>Replaying a used token finds nothing pending.</li>
        <li>A model that calls tools forever hits the step budget.</li>
        <li>Unknown tools and bad input never run, and tool errors never leak.</li>
      </ul>

      <h2 id="next-steps">Next steps</h2>
      <ul>
        <li>
          Let the loop delegate to other agents with{" "}
          <Link href={"/docs/a2a#calling-other-agents" as Route}>
            createA2aClient()
          </Link>
          {", "}and forward trace context so one request stays one trace.
        </li>
        <li>
          Move long-running tool work to{" "}
          <Link href={"/docs/jobs" as Route}>background jobs</Link> and stream
          progress, instead of holding one request open.
        </li>
        <li>
          Store sessions in your database: the in-memory map in the example is
          fine for one instance only.
        </li>
        <li>
          Expose the same tools to AI clients with the{" "}
          <Link href={"/docs/mcp" as Route}>MCP server</Link>.
        </li>
      </ul>
    </>
  );
}
