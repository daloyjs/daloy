import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Vercel AI SDK",
  description:
    "Host the Vercel AI SDK (v7) on DaloyJS. Stream chat completions, validate structured model output against your route's response schema, run tool calls behind fetchGuard, and wrap the whole thing in DaloyJS's secure-by-default guardrails. The AI SDK is web-standard, so no adapter is required.",
  path: "/docs/ai-sdk",
  keywords: [
    "Vercel AI SDK",
    "AI SDK 7",
    "streamText DaloyJS",
    "AI chat backend",
    "toUIMessageStreamResponse",
    "generateObject",
    "AI tool calling SSRF",
    "AI SDK integration",
    "secure AI backend",
  ],
  type: "article",
});

const INSTALL = `# The AI SDK is YOUR dependency, not part of @daloyjs/core.
# @daloyjs/core stays at zero runtime dependencies; you add the
# model provider you actually use.
pnpm add ai @ai-sdk/openai`;

const CHAT = `// A streaming chat endpoint, compatible with the AI SDK's
// useChat() hook on the client. The AI SDK produces a web-standard
// Response, and a DaloyJS handler can return a raw Response directly:
// the framework still finalizes it (request id, secureHeaders, CORS,
// fingerprint stripping) like any other response.
import { z } from "zod";
import { App } from "@daloyjs/core";
import { streamText, convertToModelMessages } from "ai";
import { openai } from "@ai-sdk/openai";

export const app = new App();

app.post(
  "/api/chat",
  {
    operationId: "chat",
    acknowledgeNoResponseBodySchema: true,
    request: {
      // You still validate the request. A message count cap plus the
      // default 1 MiB body limit are your first abuse guard, even on a
      // streaming route. Tighten z.unknown() to a UIMessage schema if
      // you want a stricter contract.
      body: z
        .object({ messages: z.array(z.unknown()).min(1).max(50) })
        .strict(),
    },
    responses: {
      // Streaming routes do not carry a response-body schema; OpenAPI
      // documents them as a stream. That is the one honest trade-off.
      200: { description: "UI message stream (text/event-stream)" },
    },
  },
  async ({ body, request }) => {
    const result = streamText({
      model: openai("gpt-5.1"),
      messages: convertToModelMessages(body.messages as never),
      // Cancel the upstream model call if the client disconnects.
      abortSignal: request.signal,
    });

    // Return the Response as-is. No mapping, no adapter.
    return result.toUIMessageStreamResponse();
  },
);`;

const STRUCTURED = `// This is the pattern that is genuinely better on a contract-first
// framework: the SAME Zod schema is the model's output schema, the
// route's response schema, the OpenAPI shape, and the typed client.
// One source of truth, validated twice (once by the SDK, once at the
// HTTP boundary), so a drifting model can never leak a malformed body.
import { z } from "zod";
import { App } from "@daloyjs/core";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

export const app = new App();

const Analysis = z
  .object({
    sentiment: z.enum(["positive", "neutral", "negative"]),
    summary: z.string().max(280),
    topics: z.array(z.string()).max(8),
  })
  .strict();

app.post(
  "/api/analyze",
  {
    operationId: "analyzeText",
    request: {
      body: z.object({ text: z.string().min(1).max(10_000) }).strict(),
    },
    responses: {
      // Reuse the exact schema the model is constrained to.
      200: { description: "analysis", schema: Analysis },
    },
  },
  async ({ body }) => {
    const { object } = await generateObject({
      model: openai("gpt-5.1"),
      schema: Analysis,
      prompt: body.text,
    });

    // 'object' was validated by the AI SDK. DaloyJS validates it
    // AGAIN against the response schema before it leaves, so even an
    // SDK or schema mismatch becomes a controlled 500, never a leak.
    return { status: 200 as const, body: object };
  },
);`;

const TOOLS = `// Tool calls are where prompt injection turns into SSRF: the model
// asks your tool to fetch a URL, and a poisoned prompt points it at
// 169.254.169.254 (cloud metadata) or your internal network.
// Route every tool fetch through fetchGuard() and that whole class
// of attack is default-denied, including redirects.
import { z } from "zod";
import { App, fetchGuard } from "@daloyjs/core";
import { streamText, convertToModelMessages, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";

export const app = new App();

// A guarded fetch: loopback, RFC1918, link-local, and cloud-metadata
// IPs are refused; only the hosts you allow get through.
const safeFetch = fetchGuard({ allow: ["https://api.weather.example"] });

const getWeather = tool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().min(1).max(80) }),
  execute: async ({ city }) => {
    const r = await safeFetch(
      \`https://api.weather.example/v1?city=\${encodeURIComponent(city)}\`,
    );
    return (await r.json()) as { tempC: number; summary: string };
  },
});

app.post(
  "/api/agent",
  {
    operationId: "agent",
    acknowledgeNoResponseBodySchema: true,
    request: {
      body: z.object({ messages: z.array(z.unknown()).min(1).max(50) }).strict(),
    },
    responses: { 200: { description: "UI message stream" } },
  },
  async ({ body, request }) => {
    const result = streamText({
      model: openai("gpt-5.1"),
      messages: convertToModelMessages(body.messages as never),
      tools: { getWeather },
      // AI SDK 7 multi-step tool loop, bounded so a runaway agent
      // cannot loop forever on your dime.
      stopWhen: stepCountIs(5),
      abortSignal: request.signal,
    });

    return result.toUIMessageStreamResponse();
  },
);`;

const HARDEN = `// The deployment-time layer the model never gets a vote in.
// All of this ships in @daloyjs/core with zero runtime dependencies.
import {
  App,
  createLogger,
  secureHeaders,
  requestId,
  rateLimit,
  loadShedding,
  bearerAuth,
} from "@daloyjs/core";

export const app = new App({
  // Structured JSON logs with provider credentials redacted by default.
  logger: createLogger({ level: "info" }),
  // bodyLimitBytes: 1 << 20    // 1 MiB default: caps prompt size
  // requestTimeoutMs: 30_000   // default: a stuck model call cannot hang forever
  // production auto-detected   // prod-mode 5xx redaction by default
});

app.use(secureHeaders());
app.use(requestId());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
app.use(loadShedding({ maxQueueDepth: 100, maxEventLoopDelayMs: 50 }));

// Every AI endpoint authenticates. The model is a caller, not a user.
app.use("/api/*", bearerAuth({ verify: (token) => sessions.verify(token) }));`;

export default function Page() {
  return (
    <>
      <h1>Vercel AI SDK</h1>
      <p>
        The{" "}
        <a
          href="https://ai-sdk.dev/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Vercel AI SDK
        </a>{" "}
        (v7) is built on web standards: <code>streamText()</code> and friends
        return a standard <code>Response</code> whose body is a{" "}
        <code>ReadableStream</code>. DaloyJS is a web-standard core that already
        streams and already hands you the raw <code>Request</code>, so there is{" "}
        <strong>no adapter to install</strong>. You host the AI SDK the same way
        you host any other route, and you get DaloyJS&apos;s guardrails around it
        for free.
      </p>
      <p>
        This page covers the four things worth knowing: a streaming chat
        endpoint, structured output validated against your contract, tool calls
        behind <code>fetchGuard()</code>, and the secure-by-default layer that
        wraps all of it.
      </p>

      <h2 id="install">Install</h2>
      <p>
        The AI SDK and your model provider are <em>your</em> dependencies.{" "}
        <code>@daloyjs/core</code> stays at zero runtime dependencies; it does
        not bundle or re-export the AI SDK.
      </p>
      <CodeBlock language="bash" code={INSTALL} />

      <h2 id="the-request-path">The request path</h2>
      <p>
        Every AI request flows through the same guardrails as the rest of your
        API before it ever reaches the model, and the model&apos;s output streams
        back through DaloyJS unbuffered.
      </p>
      <FlowDiagram
        title="An AI request through DaloyJS"
        numbered
        steps={[
          {
            eyebrow: "edge",
            label: "Guardrails",
            detail: "rate limit, auth, body cap, secureHeaders",
          },
          {
            eyebrow: "contract",
            label: "Request schema",
            detail: "validated before the handler runs",
            tone: "accent",
          },
          {
            eyebrow: "model",
            label: "AI SDK call",
            detail: "streamText / generateObject",
          },
          {
            eyebrow: "tools",
            label: "fetchGuard",
            detail: "tool fetches are SSRF-safe",
            tone: "accent",
          },
          {
            eyebrow: "client",
            label: "Streamed Response",
            detail: "ReadableStream, passed through",
            tone: "success",
          },
        ]}
        caption="The deployment-time layer (auth, limits, SSRF defense) holds even when the model is prompt-injected or hallucinating. That is the point: the guardrails do not depend on the model behaving."
      />

      <h2 id="streaming-chat">Streaming chat</h2>
      <p>
        The AI SDK&apos;s <code>result.toUIMessageStreamResponse()</code> returns
        a web-standard <code>Response</code>, and a DaloyJS handler can return a
        raw <code>Response</code> directly after explicitly setting{" "}
        <code>acknowledgeNoResponseBodySchema: true</code>. Without that
        acknowledgement, the route fails closed instead of silently bypassing
        response validation. The acknowledged stream passes through,
        backpressure and all, and the framework still finalizes it: it adds the
        request id, applies <code>secureHeaders()</code> and CORS, runs your{" "}
        <code>onSend</code> hooks, and strips fingerprint headers, exactly as it
        does for a structured result. This endpoint works with the AI SDK&apos;s{" "}
        <code>useChat()</code> hook on the client with no extra wiring.
      </p>
      <CodeBlock language="ts" code={CHAT} />

      <h2 id="structured-output-validated-by-your-contract">Structured output, validated by your contract</h2>
      <p>
        This is the pattern that is meaningfully better on a contract-first
        framework. With <code>generateObject()</code>, the model is constrained
        to a Zod schema. Reuse that <em>same</em> schema as the route&apos;s
        response schema and it becomes your OpenAPI shape and your typed client
        too: one source of truth. The model output is then validated twice, once
        by the AI SDK and once by DaloyJS at the HTTP boundary, so a drifting
        model or a schema mismatch becomes a controlled error instead of a
        malformed body on the wire.
      </p>
      <CodeBlock language="ts" code={STRUCTURED} />

      <h2 id="tool-calling-behind-fetchguard">Tool calling behind fetchGuard</h2>
      <p>
        AI SDK 7&apos;s tool loop is where prompt injection becomes a server-side
        request forgery problem: the model asks a tool to fetch a URL, and a
        poisoned prompt aims it at <code>169.254.169.254</code> or your internal
        network. Run every tool fetch through{" "}
        <a href="/docs/security/fetch-guard">
          <code>fetchGuard()</code>
        </a>{" "}
        and that class is default-denied, including redirect bounces. Bound the
        step count so a runaway agent cannot loop forever.
      </p>
      <CodeBlock language="ts" code={TOOLS} />

      <h2 id="the-secure-by-default-layer">The secure-by-default layer</h2>
      <p>
        None of the above is the interesting part. The interesting part is what
        DaloyJS does <em>around</em> your AI endpoint without you asking: a 1 MiB
        body cap that limits prompt size, a request timeout so a stuck model call
        cannot hang a worker, production-mode error redaction so an upstream
        provider error never leaks internals, structured logs that redact
        provider API keys, and the rate limiting and auth you add in one line
        each. The model is a caller, not a user. Treat it like one.
      </p>
      <CodeBlock language="ts" code={HARDEN} />
      <p>
        For the full argument behind this (why the deployment-time layer must
        hold when the model fails), see the blog post{" "}
        <a href="/blog/international-ai-safety-report-2026-minimum-safety-baseline-for-ai-backends">
          on the International AI Safety Report
        </a>
        , and the{" "}
        <a href="/docs/security/secure-defaults">secure-by-default</a> guide.
      </p>

      <h2 id="what-about-openapi-and-the-typed-client">What about OpenAPI and the typed client?</h2>
      <p>
        Be honest with yourself about the trade-off. A pure streaming endpoint
        cannot carry a meaningful response-body schema, so OpenAPI documents it
        as a stream and the typed client treats it as such. Endpoints that return
        structured output (the <code>generateObject()</code> pattern above) get
        the full treatment: response schema, OpenAPI shape, typed client, and
        response validation, all from the one Zod schema. Mix the two freely.
        Stream the chat, contract the structured calls.
      </p>

      <h2 id="next-steps">Next steps</h2>
      <ul>
        <li>
          <a href="/docs/streaming">Streaming (SSE &amp; NDJSON)</a> for the
          lower-level helpers behind the pass-through.
        </li>
        <li>
          <a href="/docs/security/fetch-guard">fetchGuard (SSRF)</a> for the full
          default-deny list and redirect handling.
        </li>
        <li>
          <a href="/docs/validation/zod">Zod validation</a> for the schema layer
          that powers both your contract and your structured model output.
        </li>
      </ul>
    </>
  );
}
