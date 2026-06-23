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
      <p>
        DaloyJS exposes three composition primitives for <code>Hooks</code>{" "}
        bundles. Use <code>every()</code> to package a full stack,{" "}
        <code>some()</code> to accept any one valid proof, and{" "}
        <code>except()</code> to skip a gate for specific paths.
      </p>

      <h2>
        <code>every()</code>: run a whole stack in order
      </h2>
      <p>
        <code>every(...layers)</code> merges several <code>Hooks</code> bundles
        into one that runs each layer in registration order. It is equivalent to
        calling <code>app.use(...)</code> for each bundle, but lets you name and
        reuse a curated stack. All lifecycle phases compose:
        <code> onRequest</code> and <code>onResponse</code> run in order,{" "}
        <code>beforeHandle</code> and <code>onError</code> stop on the first{" "}
        <code>Response</code>, and <code>afterHandle</code> plus{" "}
        <code>onSend</code> thread the value through each layer.
      </p>

      <FlowDiagram
        title="every() runs each layer in order"
        numbered
        steps={[
          {
            eyebrow: "layer 1",
            label: "requestId()",
            detail: "tag the request",
          },
          {
            eyebrow: "layer 2",
            label: "bearerAuth()",
            detail: "verify the token",
            tone: "accent",
          },
          {
            eyebrow: "layer 3",
            label: "rateLimit()",
            detail: "throttle the shared admin bucket",
          },
          {
            eyebrow: "result",
            label: "Handler",
            detail: "one reusable adminStack value",
            tone: "success",
          },
        ]}
        caption="Symbol-keyed security markers such as CORS, CSRF, session, and secure-headers are forwarded onto the merged bundle so boot-time guards still see them."
      />

      <CodeBlock
        code={`import { App, every, requestId, bearerAuth, rateLimit } from "@daloyjs/core";

const app = new App();

const adminStack = every(
  requestId(),
  bearerAuth({
    realm: "admin",
    validate: (token) => token === process.env.ADMIN_TOKEN,
  }),
  rateLimit({ windowMs: 60_000, max: 30, groupId: "admin" }),
);

app.use(adminStack);`}
      />

      <h2>
        <code>some()</code>: accept any one proof of identity
      </h2>
      <p>
        <code>some(...layers)</code> runs each bundle&apos;s{" "}
        <code>beforeHandle</code> in order and accepts the request as soon as
        one bundle passes without throwing or returning a <code>Response</code>.
        Use it for routes that accept more than one credential style, such as a
        bearer token or a signed session cookie.
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
            label: "session auth",
            detail: "signed cookie with a user id",
          },
        ]}
        converge={{
          eyebrow: "accepted",
          label: "First passing bundle wins",
          detail: "its ctx.state and headers are preserved",
        }}
        caption="A bundle that returns a Response counts as a denial and the next bundle gets a chance. If every bundle denies, the first denial wins."
      />

      <CodeBlock
        language="ts"
        code={`import { App, every, some, bearerAuth, session } from "@daloyjs/core";

const app = new App();

const sessionAuth = every(
  session({ secret: process.env.SESSION_SECRET! }),
  {
    beforeHandle(ctx) {
      const sessionState = ctx.state.session as
        | { data?: Record<string, unknown> }
        | undefined;

      if (typeof sessionState?.data?.userId === "string") return;

      return new Response("Unauthorized", { status: 401 });
    },
  },
);

app.use(
  some(
    bearerAuth({
      realm: "api",
      validate: (token) => token === process.env.PUBLIC_API_TOKEN,
    }),
    sessionAuth,
  ),
);`}
      />
      <p>Semantics worth knowing:</p>
      <ul>
        <li>
          The first bundle that resolves without throwing or returning a{" "}
          <code>Response</code> wins. Its context mutations, including headers
          and <code>ctx.state</code>, are preserved.
        </li>
        <li>
          A bundle that returns a <code>Response</code> is treated as a denial,
          and the next bundle gets a chance. If every bundle returns a denial,
          the first <code>Response</code> is sent.
        </li>
        <li>
          When every bundle fails and the first denial was a thrown error, that
          error is rethrown. Put the auth method whose status and{" "}
          <code>WWW-Authenticate</code> challenge you want clients to see first.
        </li>
        <li>
          Only the <code>beforeHandle</code> selection strategy changes.{" "}
          <code>afterHandle</code>, <code>onSend</code>, <code>onResponse</code>
          , and <code>onError</code> from every bundle still compose normally.
        </li>
      </ul>

      <h2>
        <code>except()</code>: apply everywhere but a few paths
      </h2>
      <p>
        <code>except(when, hooks)</code> runs a bundle on every request except
        those matching <code>when</code>. The canonical use is applying auth
        everywhere except health checks, OpenAPI JSON, and docs assets.
      </p>
      <CodeBlock
        language="ts"
        code={`import { App, except, bearerAuth } from "@daloyjs/core";

const app = new App();

app.use(
  except(
    ["/health", "/openapi.json", "/docs/**"],
    bearerAuth({ validate: (token) => token === process.env.API_TOKEN }),
  ),
);`}
      />
      <p>
        The <code>when</code> matcher accepts:
      </p>
      <ul>
        <li>
          A path string starting with <code>/</code>. <code>*</code> matches one
          path segment with no slash, and <code>**</code> matches any suffix.
        </li>
        <li>An array of path patterns.</li>
        <li>
          A predicate function that receives the request context and returns{" "}
          <code>true</code> to skip the gated bundle.
        </li>
      </ul>
      <p>
        Path matching uses the same <code>new URL(request.url).pathname</code>{" "}
        view the router sees. It is case-sensitive, exact for non-wildcard
        patterns, and does not add a rewrite or extra decode step. That makes
        exemptions fail closed for case changes, trailing-slash mismatches, and
        encoded traversal tricks.
      </p>
      <p>
        Only the wrapped bundle&apos;s <code>beforeHandle</code> phase is
        skipped. Its <code>onRequest</code>, <code>afterHandle</code>,{" "}
        <code>onSend</code>, and <code>onResponse</code> phases still run. Wrap
        each bundle with <code>except()</code> individually if you need to gate
        different phases with different rules.
      </p>

      <h2>Composing the three</h2>
      <p>
        The primitives nest. A common production shape is to run correlation,
        secure headers, and authentication everywhere, but skip the auth gate
        for health and documentation endpoints.
      </p>
      <CodeBlock
        language="ts"
        code={`import {
  App,
  every,
  except,
  requestId,
  secureHeaders,
  bearerAuth,
} from "@daloyjs/core";

const app = new App();

const protectedStack = every(
  requestId(),
  secureHeaders(),
  except(
    ["/health", "/openapi.json", "/docs/**"],
    bearerAuth({ validate: (token) => token === process.env.API_TOKEN }),
  ),
);

app.use(protectedStack);`}
      />
    </>
  );
}
