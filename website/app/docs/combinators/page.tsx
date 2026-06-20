import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Middleware combinators",
  description:
    "Compose curated middleware stacks with every(), express any-of-these-proofs auth with some(), and exempt specific paths from a gate with except(). Dependency-free Hooks composition primitives for DaloyJS.",
  path: "/docs/combinators",
  keywords: [
    "DaloyJS middleware",
    "every some except",
    "middleware composition",
    "selective middleware",
    "auth combinators",
    "Hooks composition",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Middleware combinators</h1>
      <blockquote>
        <strong>Think of it like…</strong> assembling a security checkpoint.{" "}
        <code>every()</code> chains the metal detector, the bag scan, and the ID
        check in order. <code>some()</code> says &quot;any valid ID gets you in
        — passport OR driver&apos;s license OR staff badge.&quot;{" "}
        <code>except()</code> waves the staff entrance through without the
        queue.
      </blockquote>
      <p>
        DaloyJS exposes three small composition primitives for{" "}
        <code>Hooks</code> bundles. They let you package curated middleware
        stacks as a single value, express &quot;any of these proofs is
        enough&quot; authentication, and exempt specific paths from a check —
        all without any runtime dependencies.
      </p>

      <h2>
        <code>every()</code> — run a whole stack in order
      </h2>
      <p>
        <code>every(...layers)</code> merges several <code>Hooks</code> bundles
        into one that runs each layer in registration order. It is equivalent to
        calling <code>app.use(...)</code> for each bundle, but lets you name and
        reuse a curated stack. All lifecycle phases compose, and symbol-keyed
        security markers (CORS / CSRF / session / secure-headers) are forwarded
        so boot-time guards still see them.
      </p>

      <FlowDiagram
        title="every() runs each layer in order"
        numbered
        steps={[
          { eyebrow: "layer 1", label: "requestId()", detail: "tag the request" },
          {
            eyebrow: "layer 2",
            label: "bearerAuth()",
            detail: "verify the token",
            tone: "accent",
          },
          {
            eyebrow: "layer 3",
            label: "rateLimit()",
            detail: "throttle per bucket",
          },
          {
            eyebrow: "result",
            label: "Handler",
            detail: "one reusable adminStack value",
            tone: "success",
          },
        ]}
        caption="every(...layers) merges several Hooks bundles into one that runs each layer in registration order, equivalent to calling app.use() for each. Security markers (CORS, CSRF, session, secure-headers) are forwarded so boot-time guards still see them."
      />

      <CodeBlock
        code={`import { App, every, requestId, bearerAuth, rateLimit } from "@daloyjs/core";

const app = new App();

// Package "the admin stack" as a single reusable value.
const adminStack = every(
  requestId(),
  bearerAuth({ validate: (token) => token === process.env.ADMIN_TOKEN }),
  rateLimit({ windowMs: 60_000, max: 30, groupId: "admin" }),
);

app.use(adminStack);`}
      />

      <h2>
        <code>some()</code> — accept any one proof of identity
      </h2>
      <p>
        <code>some(...layers)</code> runs each bundle&apos;s{" "}
        <code>beforeHandle</code> in order and accepts the request as soon as
        one of them passes without throwing. Use it for &quot;this route accepts
        a bearer token OR a signed session cookie OR an API key&quot; patterns.
      </p>

      <BranchDiagram
        title="some() accepts any one proof"
        source={{
          eyebrow: "request",
          label: "beforeHandle runs each bundle in order",
          detail: "first to pass wins",
        }}
        branches={[
          {
            eyebrow: "proof A",
            label: "bearerAuth()",
            detail: "valid bearer token",
          },
          {
            eyebrow: "proof B",
            label: "session()",
            detail: "signed session cookie",
          },
        ]}
        converge={{
          eyebrow: "accepted",
          label: "First passing bundle wins",
          detail: "its ctx.state / headers are preserved",
        }}
        caption="some(...layers) accepts the request as soon as one bundle passes without throwing. A bundle that returns a Response counts as a denial and the next gets a chance. If every bundle denies, the first denial wins, so place the auth method whose WWW-Authenticate challenge you want clients to see first."
      />

      <CodeBlock
        language="ts"
        code={`import { App, some, bearerAuth, session } from "@daloyjs/core";

const app = new App();

app.use(some(
  bearerAuth({ validate: (token) => token === process.env.PUBLIC_API_TOKEN }),
  session(),
));`}
      />
      <p>Semantics worth knowing:</p>
      <ul>
        <li>
          The first bundle that resolves without throwing wins; its context
          mutations (headers, <code>ctx.state</code>) are preserved.
        </li>
        <li>
          A bundle that returns a <code>Response</code> is treated as a denial,
          and the next bundle gets a chance. If every bundle denies, the first
          denial wins.
        </li>
        <li>
          When the first denial is a thrown error, that error is rethrown — so
          place the auth method whose <code>WWW-Authenticate</code> challenge
          you want clients to see first.
        </li>
        <li>
          Only the <code>beforeHandle</code> evaluation strategy changes; all
          other phases still compose normally.
        </li>
      </ul>

      <h2>
        <code>except()</code> — apply everywhere but a few paths
      </h2>
      <p>
        <code>except(when, hooks)</code> runs a bundle on every request{" "}
        <em>except</em> those matching <code>when</code>. The canonical use is
        &quot;apply auth everywhere except the public endpoints.&quot;
      </p>
      <CodeBlock
        language="ts"
        code={`import { App, except, bearerAuth } from "@daloyjs/core";

const app = new App();

app.use(except(
  ["/health", "/openapi.json", "/docs/**"],
  bearerAuth({ validate: (token) => token === process.env.API_TOKEN }),
));`}
      />
      <p>
        The <code>when</code> matcher accepts:
      </p>
      <ul>
        <li>
          A path string starting with <code>/</code>. <code>*</code> matches one
          path segment (no slash); <code>**</code> matches any suffix (zero or
          more segments).
        </li>
        <li>An array of such path patterns.</li>
        <li>
          A predicate function that receives the request context and returns{" "}
          <code>true</code> to skip the gated bundle.
        </li>
      </ul>
      <p>
        Only the <code>beforeHandle</code> phase is gated. The surrounding{" "}
        <code>onRequest</code>/<code>afterHandle</code>/<code>onSend</code>/
        <code>onResponse</code> phases still run, so shared concerns like
        request-id propagation are never accidentally exempted.
      </p>

      <h2>Composing the three</h2>
      <p>
        The primitives nest. A common production shape is &quot;run the full
        security stack everywhere except the health and docs routes&quot;:
      </p>
      <CodeBlock
        language="ts"
        code={`import { App, every, except, requestId, secureHeaders, bearerAuth } from "@daloyjs/core";

const app = new App();

const protectedStack = every(
  requestId(),
  secureHeaders(),
  bearerAuth({ validate: (token) => token === process.env.API_TOKEN }),
);

app.use(except(["/health", "/openapi.json"], protectedStack));`}
      />
    </>
  );
}
