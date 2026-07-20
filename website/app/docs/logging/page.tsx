import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Structured logging",
  description:
    "Use the built-in, dependency-free createLogger() for structured JSON logs with secure-by-default redaction of credentials, JWTs, and provider tokens. Access a request-scoped logger via ctx.state.log and swap in pino/winston when you need to.",
  path: "/docs/logging",
  keywords: [
    "DaloyJS logging",
    "structured logging",
    "createLogger",
    "log redaction",
    "request-scoped logger",
    "JSON logs TypeScript",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Structured logging</h1>
      <blockquote>
        <strong>Think of it like…</strong> a flight recorder that automatically
        bleeps out anything that sounds like a password before it writes to the
        tape. You get a faithful record of what happened, minus the secrets you
        never wanted on disk.
      </blockquote>
      <p>
        DaloyJS ships a tiny, zero-dependency structured logger. Every app gets
        one by default at <code>app.log</code>
        {", "}and every request handler gets a request-scoped child logger at{" "}
        <code>ctx.state.log</code> that is already bound to the request id.
        Records are emitted as single-line JSON so they drop straight into Loki,
        Datadog, CloudWatch, or any log aggregator.
      </p>
      <p>
        The headline feature is <strong>secure-by-default redaction</strong>
        {": "}
        common credential keys (<code>authorization</code>
        {", "}<code>cookie</code>
        {", "}
        <code>password</code>
        {", "}<code>token</code>
        {", "}provider API keys, and more) are replaced with{" "}
        <code>[REDACTED]</code> at any depth, and string values shaped like a
        JWT or an opaque provider token are scrubbed even when they appear under
        an innocent key.
      </p>

      <h2 id="the-default-logger">The default logger</h2>
      <p>
        You do not need to wire anything up. Construct an <code>App</code> and a{" "}
        <code>createLogger(&#123; level: &quot;info&quot; &#125;)</code>{" "}
        instance is attached automatically.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App();

app.get(
  "/orders/:id",
  {
    operationId: "getOrder",
    responses: { 200: { description: "ok" } },
  },
  async ({ params, state }) => {
    // Request-scoped child logger, already bound to the request id.
    state.log.info({ orderId: params.id }, "fetching order");
    return { status: 200 as const, body: { id: params.id } };
  },
);`}
      />
      <p>
        The app-level logger is also available directly when you are outside a
        request (startup, scheduled jobs, shutdown):
      </p>
      <CodeBlock
        language="ts"
        code={`app.log.info({ port: 3000 }, "server starting");
app.log.warn({ retries: 3 }, "upstream slow");`}
      />

      <h2 id="choosing-a-level">Choosing a level</h2>
      <p>
        Levels follow the familiar pino ordering: <code>trace</code> (10),{" "}
        <code>debug</code> (20), <code>info</code> (30), <code>warn</code> (40),{" "}
        <code>error</code> (50), <code>fatal</code> (60). Records below the
        configured level are dropped. Set the level when you construct the app:
      </p>
      <CodeBlock
        language="ts"
        code={`const app = new App({ logger: { level: "debug" } });

// Disable logging entirely (uses the built-in noopLogger):
const silent = new App({ logger: false });`}
      />

      <h2 id="calling-the-logger">Calling the logger</h2>
      <p>
        Every level method accepts either a message string, or an object of
        structured fields followed by an optional message. Prefer the object
        form so your fields stay queryable.
      </p>
      <CodeBlock
        language="ts"
        code={`log.info("plain message");
log.info({ userId: 42, action: "login" }, "user signed in");

// Errors: pass the error under an \`err\` key for consistent serialization.
try {
  await chargeCard();
} catch (err) {
  log.error({ err, paymentId }, "charge failed");
}`}
      />

      <h2 id="child-loggers">Child loggers</h2>
      <p>
        Use <code>child()</code> to bind fields that should appear on every
        subsequent record. This is how the request id is attached to{" "}
        <code>ctx.state.log</code>
        {", "}and it is the right tool for per-component or per-job context.
      </p>
      <CodeBlock
        language="ts"
        code={`const jobLog = app.log.child({ component: "billing-worker", runId });
jobLog.info("starting nightly invoice run");
jobLog.info({ processed: 1280 }, "done");`}
      />

      <h2 id="redaction-secure-by-default">Redaction (secure by default)</h2>
      <p>
        Redaction is on by default. Keys are matched case-insensitively at any
        depth and replaced with <code>[REDACTED]</code>
        {". "}The built-in <code>DEFAULT_REDACT_KEYS</code> list covers the
        usual suspects plus AI / LLM provider credential headers. In addition,
        any string value shaped like a JWT (<code>eyJ…</code>) or an opaque
        provider token (GitHub <code>ghp_…</code>
        {", "}AWS <code>AKIA…</code>
        {", "}Stripe <code>sk_live_…</code>
        {", "}OpenAI <code>sk-…</code>
        {", "}and more) is scrubbed regardless of its key.
      </p>
      <FlowDiagram
        title="From log call to log line"
        steps={[
          {
            eyebrow: "your call",
            label: "log.info(fields, msg)",
            detail: "{ userId, authorization, ... }",
            tone: "accent",
          },
          {
            eyebrow: "bound context",
            label: "requestId + child fields",
            detail: "ctx.state.log child bindings",
          },
          {
            eyebrow: "secure by default",
            label: "Redaction",
            detail: "keys + JWT / token values → [REDACTED]",
            tone: "danger",
          },
          {
            eyebrow: "one line",
            label: "JSON record",
            detail: '{"level":"info",...}',
            tone: "success",
          },
          {
            eyebrow: "sink",
            label: "write()",
            detail: "stdout → Loki · Datadog · CloudWatch",
            tone: "muted",
          },
        ]}
        caption="Every record is enriched with the request id and any child bindings, scrubbed of credential-shaped keys and values, serialized to a single JSON line, then handed to the output sink. Redaction happens before anything is written, so secrets never hit disk."
      />
      <CodeBlock
        language="ts"
        code={`log.info(
  {
    userId: 7,
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    note: "token is sk-ant-0123456789abcdef0123456789",
  },
  "request",
);
// => {"level":"info","userId":7,"authorization":"[REDACTED]",
//     "note":"token is [REDACTED]","msg":"request",...}`}
      />
      <p>
        Extend the defaults with your own keys, change the replacement string,
        or opt out entirely:
      </p>
      <CodeBlock
        language="ts"
        code={`import { createLogger } from "@daloyjs/core";

const log = createLogger({
  level: "info",
  redact: {
    keys: ["ssn", "card_number"], // merged with DEFAULT_REDACT_KEYS
    censor: "***",
  },
});

// Disable redaction (not recommended outside local debugging):
const raw = createLogger({ redact: false });`}
      />
      <p>
        Do not turn redaction off in production. The default list exists because
        these exact keys are the ones most commonly observed leaking secrets
        into log aggregators in real-world incidents.
      </p>
      <p>
        Request URLs are a separate path: the structured redactor matches field{" "}
        <em>names</em>
        {", "}so a secret sitting in a query string under the field{" "}
        <code>url</code> would not be renamed-matched. The framework therefore
        runs request URLs through <code>sanitizeUrlForLog</code> before they
        land in the per-request log record. That helper redacts values for keys
        in <code>SENSITIVE_URL_QUERY_KEYS</code> (and known prefixes), JWT-like
        query values, opaque credential-shaped values, and userinfo in the URL
        authority, so OAuth <code>?code=</code>
        {", "}<code>?access_token=</code>
        {", "}
        and signed-URL signatures do not persist under <code>url</code>
        {". "}Export it from <code>@daloyjs/core</code> when you bind URLs into
        your own log calls.
      </p>
      <CodeBlock
        language="ts"
        code={`import { sanitizeUrlForLog } from "@daloyjs/core";

log.info(
  { url: sanitizeUrlForLog(request.url) },
  "outbound callback",
);`}
      />

      <h2 id="bring-your-own-logger-pino-winston">
        Bring your own logger (pino, winston)
      </h2>
      <p>
        The <code>logger</code> option accepts any object implementing the{" "}
        <code>Logger</code> interface (the <code>trace</code>/<code>debug</code>
        /<code>info</code>/<code>warn</code>/<code>error</code>/
        <code>fatal</code> methods plus <code>child()</code>). pino already
        matches this shape, so you can pass it directly:
      </p>
      <CodeBlock
        language="ts"
        code={`import pino from "pino";
import { App } from "@daloyjs/core";

const app = new App({ logger: pino({ level: "info" }) });`}
      />
      <p>
        When you bring your own logger, redaction becomes that logger&apos;s
        responsibility, so configure pino&apos;s <code>redact</code> option to
        match the protection DaloyJS gives you for free.
      </p>

      <h2 id="customizing-the-output-sink">Customizing the output sink</h2>
      <p>
        By default records are written to stdout. Provide a <code>write</code>{" "}
        function to redirect them (for example, to a buffer in tests):
      </p>
      <CodeBlock
        language="ts"
        code={`import { createLogger } from "@daloyjs/core";

const lines: string[] = [];
const log = createLogger({ write: (line) => lines.push(line) });`}
      />

      <h2 id="when-to-reach-for-it">When to reach for it</h2>
      <ul>
        <li>
          <strong>Inside handlers:</strong> use <code>ctx.state.log</code> so
          every line is correlated to the request id automatically.
        </li>
        <li>
          <strong>Background work:</strong> derive a{" "}
          <code>app.log.child(&#123; component &#125;)</code> so jobs are easy
          to filter.
        </li>
        <li>
          <strong>Security-sensitive payloads:</strong> rely on the default
          redaction rather than hand-stripping fields before you log them.
        </li>
      </ul>
    </>
  );
}
