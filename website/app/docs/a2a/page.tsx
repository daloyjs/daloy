import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram, SequenceDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "DaloyJS A2A agent endpoint",
  description:
    "Expose an existing DaloyJS service as an Agent2Agent (A2A) 1.0 peer: a public Agent Card, the JSON-RPC binding, multi-turn tasks, fail-closed task ownership, and a production auth boot guard, with no extra runtime dependency.",
  path: "/docs/a2a",
  keywords: [
    "DaloyJS A2A",
    "Agent2Agent protocol",
    "A2A 1.0",
    "A2A JSON-RPC",
    "Agent Card",
    "agent-card.json",
    "createA2aHandler",
    "a2aRoutes",
    "memoryTaskStore",
    "A2A vs MCP",
    "agent to agent TypeScript",
    "A2A TypeScript server",
    "SendMessage",
    "GetTask",
    "input-required",
  ],
  type: "article",
});

const INSTALL = `pnpm add @daloyjs/core`;

const SERVER = `import {
  App,
  a2aData,
  a2aRoutes,
  bearerAuth,
  createA2aHandler,
  timingSafeEqual,
} from "@daloyjs/core";

const agent = createA2aHandler({
  card: {
    name: "inventory-agent",
    description: "Answers stock questions for Acme products.",
    version: "1.0.0",
    // Absolute public URL of the JSON-RPC route below.
    url: "https://api.acme.example/a2a",
    provider: { organization: "Acme", url: "https://acme.example" },
    skills: [
      {
        id: "stock-lookup",
        name: "Stock lookup",
        description: "Units on hand for a SKU. Send { sku } as a data part.",
        tags: ["inventory"],
        examples: ['{"sku":"ABC-1"}'],
      },
    ],
    // Tell peers how to authenticate. Required unless the routes are public.
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
  },
  // Your logic. DaloyJS never guesses a skill: you read the message and decide.
  onMessage: async ({ message }) => {
    const input = message.parts.find((part) => part.data !== undefined)?.data as
      | { sku?: string }
      | undefined;
    if (!input?.sku) return { status: "rejected", message: "Send { sku } as a data part." };
    const units = await inventory.unitsFor(input.sku);
    return {
      status: "completed",
      artifacts: [{ name: "stock", parts: [a2aData({ sku: input.sku, units })] }],
    };
  },
});

const app = new App();
const auth = bearerAuth({
  validate: (token) => timingSafeEqual(token, process.env.A2A_TOKEN!),
});
// Auth covers the JSON-RPC POST only; the Agent Card stays public.
for (const route of a2aRoutes("/a2a", agent, { hooks: auth })) {
  app.route(route);
}`;

const CARD = `{
  "name": "inventory-agent",
  "description": "Answers stock questions for Acme products.",
  "supportedInterfaces": [
    { "url": "https://api.acme.example/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }
  ],
  "provider": { "organization": "Acme", "url": "https://acme.example" },
  "version": "1.0.0",
  "capabilities": { "streaming": false, "pushNotifications": false, "extendedAgentCard": false },
  "securitySchemes": { "bearer": { "httpAuthSecurityScheme": { "scheme": "Bearer" } } },
  "securityRequirements": [{ "schemes": { "bearer": { "list": [] } } }],
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [{ "id": "stock-lookup", "name": "Stock lookup", "description": "...", "tags": ["inventory"] }]
}`;

const REQUEST = `POST /a2a HTTP/1.1
Content-Type: application/json
A2A-Version: 1.0
Authorization: Bearer <token>

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "9b1c...",
      "role": "ROLE_USER",
      "parts": [{ "data": { "sku": "ABC-1" }, "mediaType": "application/json" }]
    }
  }
}`;

const RESPONSE = `{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "3f0e...",
      "contextId": "c71a...",
      "status": { "state": "TASK_STATE_COMPLETED", "timestamp": "2026-09-28T10:30:00.000Z" },
      "artifacts": [
        { "artifactId": "a1...", "name": "stock", "parts": [{ "data": { "sku": "ABC-1", "units": 12 }, "mediaType": "application/json" }] }
      ],
      "history": [{ "messageId": "9b1c...", "role": "ROLE_USER", "parts": [...] }]
    }
  }
}`;

const REPLIES = `// 1. Direct answer, no task created. Returns { message }.
onMessage: ({ text }) => \`You said: \${text}\`,

// 2. Same, with parts and metadata.
onMessage: () => ({ reply: [a2aText("**Done**", "text/markdown")], metadata: { source: "cache" } }),

// 3. A task in a final state. Returns { task }.
onMessage: () => ({
  status: "completed", // or "failed" | "rejected"
  message: "Here is your report.",
  artifacts: [{ name: "report", parts: [a2aData(report)] }],
}),

// 4. An interrupted task the client continues later (needs a task store).
onMessage: ({ task }) =>
  task ? { status: "completed", artifacts: [...] } : { status: "input-required", message: "Which SKU?" },`;

const STATEFUL = `import { createA2aHandler, memoryTaskStore } from "@daloyjs/core";

const agent = createA2aHandler({
  card,
  // Process-local and bounded. Use a shared store on serverless or multi-instance.
  taskStore: memoryTaskStore({ maxTasks: 1000, ttlMs: 60 * 60 * 1000 }),
  // Who owns a task. Every store call is scoped by this value.
  taskOwner: ({ state }) => (state.user as { sub?: string } | undefined)?.sub,
  onMessage: ({ task, text }) => {
    if (!task) return { status: "input-required", message: "Which SKU?" };
    return { status: "completed", artifacts: [{ parts: [a2aData(lookup(text))] }] };
  },
});`;

const STORE = `import type { A2aTaskStore } from "@daloyjs/core";

const redisTaskStore: A2aTaskStore = {
  async get(owner, taskId) {
    const raw = await redis.get(\`a2a:\${owner}:\${taskId}\`);
    return raw ? JSON.parse(raw) : undefined;
  },
  async set(owner, task) {
    await redis.set(\`a2a:\${owner}:\${task.id}\`, JSON.stringify(task), { EX: 3600 });
  },
  // list() is optional. Without it, ListTasks answers -32004.
};`;

const CLIENT = `import { ClientFactory } from "@a2a-js/sdk/client";

// Any A2A 1.0 client works. This is the official Linux Foundation JS SDK.
const client = await new ClientFactory().createFromUrl("https://api.acme.example");
const result = await client.sendMessage({
  message: {
    messageId: crypto.randomUUID(),
    role: 1, // ROLE_USER
    parts: [{ content: { $case: "data", value: { sku: "ABC-1" } } }],
  },
});`;

const DELEGATE = `import { a2aData, createA2aClient } from "@daloyjs/core";

// One client per remote agent, created once at startup.
const inventory = createA2aClient({
  url: "https://inventory.partner.example", // card at /.well-known/agent-card.json
  headers: async () => ({ authorization: \`Bearer \${await tokenFor("inventory")}\` }),
  propagateTrace: true, // forward the caller's traceparent (opt-in)
});

// Inside your own onMessage (or any route handler):
onMessage: async ({ message, request }) => {
  const result = await inventory.sendMessage([a2aData({ sku: "ABC-1" })], { request });
  if (result.task?.status.state === "TASK_STATE_COMPLETED") {
    return { status: "completed", artifacts: result.task.artifacts ?? [] };
  }
  return { status: "failed", message: "Inventory agent could not answer." };
},`;

const CLIENT_ERRORS = `import { A2aClientError, A2A_ERROR_CODES } from "@daloyjs/core";

try {
  await inventory.getTask(taskId);
} catch (error) {
  if (error instanceof A2aClientError && error.code === A2A_ERROR_CODES.taskNotFound) {
    // The remote agent answered: that task does not exist (or is not yours).
  }
  // error.code === 0 means the client refused: unsafe card, timeout,
  // oversized or malformed response. error.cause holds the underlying error.
  throw error;
}`;

const ERRORS = `import { A2aError, A2A_ERROR_CODES } from "@daloyjs/core";

onMessage: ({ message }) => {
  if (message.parts.length > 3) {
    // Caller-visible JSON-RPC error. Keep secrets out of the message.
    throw new A2aError(A2A_ERROR_CODES.invalidParams, "Send at most three parts.");
  }
  // Any other throw becomes a redacted -32603 "Internal error".
  ...
}`;

const METHOD_ROWS: Array<[string, string]> = [
  ["SendMessage", "Runs onMessage. Returns { message } or { task }."],
  ["GetTask", "Needs a task store. Otherwise -32001 TaskNotFound."],
  ["CancelTask", "Needs a task store. Finished tasks answer -32002 TaskNotCancelable."],
  ["ListTasks", "Needs a store with list(). Otherwise -32004 UnsupportedOperation."],
  ["SendStreamingMessage, SubscribeToTask", "-32004 UnsupportedOperation (streaming: false)."],
  ["*TaskPushNotificationConfig", "-32003 PushNotificationNotSupported (pushNotifications: false)."],
  ["GetExtendedAgentCard", "-32004 UnsupportedOperation (extendedAgentCard: false)."],
  ["Anything else, including 0.3 names like message/send", "-32601 Method not found."],
];

export default function Page() {
  return (
    <>
      <h1>DaloyJS A2A agent endpoint</h1>
      <p>
        <a
          href="https://a2a-protocol.org/latest/specification/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Agent2Agent (A2A)
        </a>{" "}
        is the Linux Foundation protocol for one agent calling another agent it
        does not share memory, tools, or code with. DaloyJS can expose an
        existing service as an A2A 1.0 peer: other agents discover it through a
        public Agent Card and send it work over the JSON-RPC binding.
      </p>
      <p>
        The split is deliberate. DaloyJS owns the protocol: the card, the
        envelope, version and extension negotiation, validation, error codes,
        task bookkeeping, and the auth guardrails. You own the meaning: one{" "}
        <code>onMessage</code> function reads the message and decides what to
        do. DaloyJS is not an agent framework and runs no LLM or skill router.
        If you want a model to interpret requests, call it from your handler.
      </p>

      <FlowDiagram
        title="A DaloyJS service as an A2A peer"
        steps={[
          {
            label: "Peer agent",
            detail: "any A2A 1.0 client",
            tone: "accent",
          },
          {
            label: "Agent Card",
            detail: "GET /.well-known/agent-card.json",
            tone: "default",
          },
          {
            label: "JSON-RPC endpoint",
            detail: "POST /a2a, auth + validation",
            tone: "default",
          },
          {
            label: "Your onMessage",
            detail: "reply or task result",
            tone: "success",
          },
          {
            label: "Existing systems",
            detail: "database, REST handlers, queues",
            tone: "muted",
          },
        ]}
        caption="Discovery is public so a peer can learn how to authenticate. Everything after the card goes through your auth middleware, body limits, timeouts, and the A2A validator before your handler runs."
      />

      <h2 id="a2a-vs-mcp">A2A, MCP, and OpenAPI</h2>
      <p>
        These are three faces of the same service, not competitors. Pick by
        who is calling.
      </p>
      <div className="not-prose overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left">Surface</th>
              <th className="p-2 text-left">Caller</th>
              <th className="p-2 text-left">Unit of work</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-2">
                <a href="/docs/openapi">OpenAPI</a> + typed client
              </td>
              <td className="p-2">Humans and generated SDKs</td>
              <td className="p-2">HTTP route</td>
            </tr>
            <tr>
              <td className="p-2">
                <a href="/docs/mcp">MCP</a>
              </td>
              <td className="p-2">An AI client using your service as a tool</td>
              <td className="p-2">Tool call, resource read</td>
            </tr>
            <tr>
              <td className="p-2">A2A</td>
              <td className="p-2">Another agent treating you as an opaque peer</td>
              <td className="p-2">Message, task with a lifecycle, artifacts</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        If the question is &quot;can Cursor call my inventory API?&quot;, that is
        MCP. If it is &quot;can a partner&apos;s procurement agent hand my
        service a job and get a result back?&quot;, that is A2A.
      </p>

      <h2 id="install">Install</h2>
      <p>
        A2A ships in core at <code>@daloyjs/core/a2a</code> (also re-exported
        from <code>@daloyjs/core</code>). No extra SDK is installed.
      </p>
      <CodeBlock code={INSTALL} language="bash" />

      <h2 id="create-an-agent">Create an agent</h2>
      <p>
        <code>createA2aHandler()</code> builds the protocol layer and{" "}
        <code>a2aRoutes()</code> mounts it. The card route is{" "}
        <code>GET /.well-known/agent-card.json</code>. The JSON-RPC route is{" "}
        <code>POST</code> at the path you choose, plus a <code>GET</code> hint
        (405) and <code>OPTIONS</code> preflight. The <code>hooks</code> option
        applies auth to the <code>POST</code> route only, so the card stays
        reachable without an <code>except()</code>.
      </p>
      <CodeBlock code={SERVER} />
      <p>
        The route handlers forward the Daloy <code>ctx.state</code> to{" "}
        <code>onMessage</code>, so the principal your auth middleware stored is
        available as <code>ctx.state</code> inside the handler.
      </p>

      <h2 id="the-agent-card">The Agent Card</h2>
      <p>
        You write the identity and skills. DaloyJS derives{" "}
        <code>supportedInterfaces</code> and <code>capabilities</code> from what
        the handler actually implements, so the card cannot advertise a feature
        that would fail when called. The card is validated at startup: it needs
        at least one skill, every skill needs an id, name, description, and a
        tag, URLs must be absolute <code>http(s)</code> without embedded
        credentials, and every security requirement must name a declared
        scheme.
      </p>
      <CodeBlock code={CARD} language="json" />
      <p>
        The card response carries <code>Cache-Control: public, max-age=300</code>{" "}
        (tune with <code>cardMaxAgeSeconds</code>) and a strong{" "}
        <code>ETag</code>, and answers <code>If-None-Match</code> with{" "}
        <code>304</code>. Skills are descriptive. A2A has no skill id on
        messages, which is exactly why your handler decides what to run.
      </p>

      <h2 id="wire-format">Wire format</h2>
      <p>
        DaloyJS implements the A2A 1.0 JSON-RPC binding: PascalCase methods,
        ProtoJSON field names, <code>SCREAMING_SNAKE</code> enums, and parts
        whose member name is the type (<code>text</code>, <code>raw</code>,{" "}
        <code>url</code>, or <code>data</code>). The 0.3 <code>kind</code>{" "}
        field and <code>message/send</code> style names are not accepted.
      </p>
      <CodeBlock code={REQUEST} language="http" />
      <CodeBlock code={RESPONSE} language="json" />

      <h2 id="replies">What onMessage returns</h2>
      <p>
        Return a string or <code>{"{ reply }"}</code> for a direct answer that
        creates no task. Return <code>{"{ status }"}</code> for a task. The
        spec allows both, and a direct message is the right choice for simple,
        stateless answers.
      </p>
      <CodeBlock code={REPLIES} />
      <p>
        The context also carries <code>text</code> (all text parts joined),{" "}
        <code>contextId</code>, the <code>taskId</code> a task would get,{" "}
        <code>acceptedOutputModes</code>, request <code>metadata</code>, the
        extensions the client activated, and <code>signal</code>, which aborts
        when the request times out.
      </p>

      <h2 id="multi-turn-tasks">Multi-turn tasks</h2>
      <p>
        Without a task store the agent is stateless, which fits serverless and
        edge deployments. Add a <code>taskStore</code> to enable{" "}
        <code>GetTask</code>, <code>CancelTask</code>, <code>ListTasks</code>,
        and the <code>input-required</code> / <code>auth-required</code> states
        a client continues by sending another message with the same{" "}
        <code>taskId</code>.
      </p>
      <SequenceDiagram
        title="Continuing an input-required task"
        participants={["Peer agent", "DaloyJS A2A", "onMessage"]}
        steps={[
          {
            from: "Peer agent",
            to: "DaloyJS A2A",
            label: "SendMessage",
            detail: '"Check stock"',
            kind: "request",
          },
          {
            from: "DaloyJS A2A",
            to: "onMessage",
            label: "ctx.task is undefined",
            kind: "note",
          },
          {
            from: "DaloyJS A2A",
            to: "Peer agent",
            label: "task: TASK_STATE_INPUT_REQUIRED",
            detail: '"Which SKU?" (stored under the caller)',
            kind: "response",
          },
          {
            from: "Peer agent",
            to: "DaloyJS A2A",
            label: "SendMessage with taskId",
            detail: '"ABC-1"',
            kind: "request",
          },
          {
            from: "DaloyJS A2A",
            to: "onMessage",
            label: "ctx.task is a copy of the stored task",
            kind: "note",
          },
          {
            from: "DaloyJS A2A",
            to: "Peer agent",
            label: "task: TASK_STATE_COMPLETED",
            detail: "artifacts + history",
            kind: "response",
          },
        ]}
        caption="A message to a finished task is refused with -32004, and a contextId that does not match the task is refused with -32602, as the spec requires."
      />
      <CodeBlock code={STATEFUL} />
      <p>
        <strong>Task ownership fails closed.</strong> A task store requires{" "}
        <code>taskOwner</code>. Every store call is scoped by the value it
        returns, so one caller can never read, continue, cancel, or list
        another caller&apos;s tasks: those requests get{" "}
        <code>-32001 TaskNotFound</code>, which does not reveal that the task
        exists. When <code>taskOwner</code> returns nothing, the request is
        refused with <code>401</code> instead of falling into a shared bucket.
        With tenancy, include the tenant in the owner, for example{" "}
        <code>JSON.stringify([state.tenant, user.sub])</code>.
      </p>
      <p>
        <code>memoryTaskStore()</code> is bounded, deep-copies on read and
        write, and expires entries. On serverless or several instances, a
        follow-up call can land somewhere else, so bring a shared store:
      </p>
      <CodeBlock code={STORE} />

      <h2 id="methods">Methods and capabilities</h2>
      <p>
        Version 1 is honest about what it does not do. The card says{" "}
        <code>streaming</code>, <code>pushNotifications</code>, and{" "}
        <code>extendedAgentCard</code> are <code>false</code>, and those methods
        return the errors the spec requires instead of hanging.
      </p>
      <div className="not-prose overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left">Method</th>
              <th className="p-2 text-left">Behavior</th>
            </tr>
          </thead>
          <tbody>
            {METHOD_ROWS.map(([method, behavior]) => (
              <tr key={method}>
                <td className="p-2">
                  <code>{method}</code>
                </td>
                <td className="p-2">{behavior}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>Versioning.</strong> Clients send <code>A2A-Version: 1.0</code>.
        An empty header means 0.3 per the spec, and 0.3 is not implemented, so
        it is refused with <code>-32009 VersionNotSupported</code>.{" "}
        <strong>Extensions.</strong> A card extension marked{" "}
        <code>required: true</code> must be activated in the{" "}
        <code>A2A-Extensions</code> header, or the request gets{" "}
        <code>-32008</code>.
      </p>

      <h2 id="calling-your-agent">Calling your agent</h2>
      <p>
        Any A2A 1.0 client can call a DaloyJS agent. This example uses the
        official JS SDK, which DaloyJS is tested against for discovery, direct
        replies, multi-turn tasks, <code>GetTask</code>,{" "}
        <code>ListTasks</code>, and error mapping.
      </p>
      <CodeBlock code={CLIENT} />

      <h2 id="error-handling">Error handling</h2>
      <p>
        Validation failures return <code>-32602</code> with a{" "}
        <code>google.rpc.BadRequest</code> list of field violations. A2A errors
        carry a <code>google.rpc.ErrorInfo</code> with the spec&apos;s reason,
        for example <code>TASK_NOT_FOUND</code>. Throw <code>A2aError</code> to
        choose the code yourself. Unexpected throws become a redacted{" "}
        <code>-32603</code>. Raw error text is shown only when{" "}
        <code>NODE_ENV</code> is <code>development</code> or <code>test</code>
        {", "}and never on an App running in production unless you set{" "}
        <code>exposeInternalErrors</code> explicitly.
      </p>
      <CodeBlock code={ERRORS} />

      <h2 id="calling-other-agents">Calling other agents</h2>
      <p>
        <code>createA2aClient()</code> is the other side: your service delegates
        work to a remote A2A agent, for example a coordinator handing a task to
        a specialist. It speaks the same 1.0 JSON-RPC binding and is tested
        against the official A2A SDK&apos;s reference server.
      </p>
      <CodeBlock code={DELEGATE} />
      <p>
        The defaults assume the remote agent is not fully trusted, because an
        Agent Card is written by the other party:
      </p>
      <ul>
        <li>
          <strong>SSRF-guarded transport.</strong> The default{" "}
          <code>fetch</code> is <code>fetchGuard()</code>, which refuses
          loopback, private, link-local, and cloud-metadata addresses. On
          runtimes without a DNS resolver (Cloudflare Workers), pass{" "}
          <code>fetchGuard({"{ resolve }"})</code>.
        </li>
        <li>
          <strong>The card cannot redirect your credentials.</strong> The card
          is fetched without your headers, and the JSON-RPC URL it names must
          share the card&apos;s origin. Anything else is refused before a single
          credential is sent, unless you list it in{" "}
          <code>allowedOrigins</code>.
        </li>
        <li>
          <strong>No surprises on the wire.</strong> <code>https:</code> only
          (loopback excepted), redirects are never followed, responses are
          size-capped (<code>maxResponseBytes</code>, 1 MiB) and parsed with
          prototype-pollution-safe JSON, and the JSON-RPC id must match.
        </li>
        <li>
          <strong>Timeouts on every call</strong> (<code>timeoutMs</code>, 10
          seconds), combined with any <code>signal</code> you pass.
        </li>
        <li>
          <strong>Fresh credentials.</strong> Pass <code>headers</code> as a
          function and it runs per request, so short-lived tokens do not go
          stale in a long-lived client.
        </li>
      </ul>
      <p>
        <code>sendMessage</code> accepts a string, an array of parts, or a full
        message with <code>taskId</code> / <code>contextId</code> to continue a
        task. <code>getTask</code>, <code>cancelTask</code>, and{" "}
        <code>listTasks</code> map to the methods of the same name.
      </p>
      <CodeBlock code={CLIENT_ERRORS} />

      <h3 id="trace-propagation">Trace propagation</h3>
      <p>
        When one request passes through several agents, you want one trace.
        Propagation is <strong>off by default</strong>, because trace ids are
        not always meant to cross into another organization&apos;s systems.
        With <code>propagateTrace: true</code>, the client copies a valid W3C{" "}
        <code>traceparent</code> (and <code>tracestate</code>) from the{" "}
        <code>request</code> you pass to each call. <code>baggage</code> is
        never forwarded, since it often carries user data, and malformed or
        all-zero trace ids are dropped. If you use OpenTelemetry, pass a
        function instead and run your own propagator, so the remote span
        becomes a child of your current span:
      </p>
      <CodeBlock
        code={`propagateTrace: (headers) =>
  propagation.inject(context.active(), headers, {
    set: (carrier, key, value) => carrier.set(key, value),
  }),`}
      />

      <h2 id="what-stays-out-of-core">What stays out of core</h2>
      <ul>
        <li>
          Streaming (<code>SendStreamingMessage</code>, SSE) and push
          notifications. Planned only when real users need work that outlives
          one request.
        </li>
        <li>The gRPC and HTTP+JSON bindings. The card lists JSON-RPC only.</li>
        <li>Signed and extended Agent Cards.</li>
        <li>
          Agent orchestration, skill routing, memory, and LLM calls. Those
          belong in your handler or an agent framework.
        </li>
        <li>
          Fetching <code>url</code> parts. DaloyJS validates that they are{" "}
          <code>http(s)</code> without credentials, but never fetches them.
        </li>
      </ul>

      <h2 id="security-checklist">Security checklist</h2>
      <ul>
        <li>
          Authenticate the JSON-RPC route with the <code>hooks</code> option or
          app middleware. In production a <code>secureDefaults</code> App{" "}
          <a href="/docs/security/boot-guards#9-unauthenticated-a2a-endpoint">
            refuses to boot
          </a>{" "}
          without it. For a genuinely public, read-only agent, opt out with{" "}
          <code>
            a2aRoutes(path, handler, {"{"} public: true {"}"})
          </code>
          {"."}
        </li>
        <li>
          Keep the card truthful and free of internal details. It is public, and
          other agents act on it. Do not list operator-only skills.
        </li>
        <li>
          Use an <code>https:</code> card URL. In production, registration
          throws on <code>http:</code> for any non-loopback host.
        </li>
        <li>
          Resolve <code>taskOwner</code> from the verified identity only, never
          from a header or message field the caller controls.
        </li>
        <li>
          Route any fetch of a <code>url</code> part through{" "}
          <a href="/docs/security/fetch-guard">
            <code>fetchGuard()</code>
          </a>{" "}
          so a peer cannot aim your service at loopback, private, or
          cloud-metadata addresses.
        </li>
        <li>
          Treat message text and data as untrusted input, especially if your
          handler passes it to a model. A peer agent is just another client.
        </li>
        <li>
          Rate-limit the endpoint like any other API route, and keep the
          default <code>Origin</code> check. Add trusted browser apps to{" "}
          <code>allowedOrigins</code> instead of a wildcard CORS layer.
        </li>
      </ul>
    </>
  );
}
