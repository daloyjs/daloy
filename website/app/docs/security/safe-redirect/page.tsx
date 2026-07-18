import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Open redirect protection",
  description:
    "Refuse open-redirect inputs with safeRedirect(): validate every ?next= / ?returnTo= candidate against an explicit allowlist of internal paths and external origins before emitting a Location header. Strict, dependency-free defaults.",
  path: "/docs/security/safe-redirect",
  keywords: [
    "DaloyJS safeRedirect",
    "open redirect",
    "unvalidated redirect",
    "Location header injection",
    "returnTo allowlist",
    "OWASP open redirect",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Open redirect protection</h1>
      <blockquote>
        <strong>Think of it like…</strong> a receptionist who will only forward
        your call to extensions on an approved list. Hand them a number that
        isn&apos;t on the sheet and they hang up. They never dial a random
        outside line just because you asked nicely.
      </blockquote>
      <p>
        Open redirects (OWASP &quot;Unvalidated Redirects and Forwards&quot;,
        Aikido Top 10 #10) happen when an app blindly trusts a{" "}
        <code>?next=…</code> / <code>?returnTo=…</code> query parameter and
        emits a <code>Location</code> header pointing wherever the attacker
        wants, turning your trusted domain into a phishing launch pad.{" "}
        <code>safeRedirect()</code> validates every candidate URL against an
        explicit allowlist of internal paths and external origins{" "}
        <strong>before</strong> building the redirect response.
      </p>

      <FlowDiagram
        title="Validate before redirecting"
        steps={[
          {
            eyebrow: "input",
            label: "Candidate URL",
            detail: "?next= / ?returnTo=",
          },
          {
            eyebrow: "scheme",
            label: "Dangerous scheme?",
            detail: "javascript:/data:/file: to refused",
            tone: "danger",
          },
          {
            eyebrow: "shape",
            label: "Protocol-relative or CR/LF?",
            detail: "// or backslash or control chars to refused",
            tone: "danger",
          },
          {
            eyebrow: "allowlist",
            label: "Path or origin allowed?",
            detail: "allowedPaths / allowedOrigins exact match",
          },
          {
            eyebrow: "allowed",
            label: "Emit Location",
            detail: "303 + Cache-Control: no-store",
            tone: "success",
          },
          {
            eyebrow: "rejected",
            label: "Fallback or throw",
            detail: "fallback path, else OpenRedirectBlockedError",
            tone: "danger",
          },
        ]}
        caption="Every candidate runs the full gauntlet before any Location header is built. Dangerous schemes, protocol-relative escapes, and control characters are refused outright; only an exact allowlist match is emitted. A rejected target either falls back or throws."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        code={`import { App, safeRedirect } from "@daloyjs/core";

const app = new App();

app.get(
  "/login/callback",
  {
    operationId: "loginCallback",
    responses: { 303: { description: "redirect" } },
  },
  async ({ request }) => {
    const next = new URL(request.url).searchParams.get("next") ?? "/";
    return safeRedirect(next, {
      allowedPaths: ["/", "/dashboard", "/account"],
      allowedOrigins: ["https://app.example.com"],
      fallback: "/",
    });
  },
);`}
      />
      <p>
        <code>safeRedirect()</code> returns a Web-standard <code>Response</code>{" "}
        with the validated <code>Location</code> header and a{" "}
        <code>Cache-Control: no-store</code> directive so a per-request redirect
        is never cached and reused.
      </p>

      <h2 id="strict-by-default">Strict by default</h2>
      <p>The defaults are deliberately conservative:</p>
      <ul>
        <li>
          Same-origin paths must start with <code>/</code> and must not start
          with <code>{"//"}</code> or <code>{"/\\"}</code> (browsers treat those
          as protocol-relative URLs that escape your origin).
        </li>
        <li>
          Backslashes, control characters, and CR/LF are rejected to stop
          response-splitting and homograph tricks.
        </li>
        <li>
          Absolute URLs are allowed only when their <code>origin</code> exactly
          matches an entry in <code>allowedOrigins</code>.
        </li>
        <li>
          <code>javascript:</code>, <code>data:</code>, <code>vbscript:</code>,
          and <code>file:</code> schemes are always refused, even if you
          accidentally wrote one into the allowlist.
        </li>
        <li>
          The default status is <code>303 See Other</code>, the
          POST-redirect-GET-safe choice.
        </li>
      </ul>

      <h2 id="allowing-internal-paths-and-external-origins">Allowing internal paths and external origins</h2>
      <CodeBlock
        language="ts"
        code={`// Same-origin paths only (exact pathname match).
safeRedirect(next, { allowedPaths: ["/", "/dashboard", "/orders"] });

// Permit a specific external origin (scheme + host + optional port).
safeRedirect(next, {
  allowedPaths: ["/"],
  allowedOrigins: ["https://app.example.com", "https://admin.example.com"],
});

// Escape hatch: accept ANY same-origin path (disables path allowlisting).
safeRedirect(next, { allowedPaths: ["/*"] });`}
      />
      <p>
        Path matching is exact on <code>pathname</code>. Query strings and
        fragments on the candidate are preserved in the final{" "}
        <code>Location</code> but ignored when deciding whether the target is
        allowed.
      </p>

      <h2 id="fallback-vs-throwing">Fallback vs. throwing</h2>
      <p>
        When a candidate is rejected, you choose the behavior. Provide a{" "}
        <code>fallback</code> path and the user is quietly redirected there.
        Omit it and <code>safeRedirect()</code> throws an{" "}
        <code>OpenRedirectBlockedError</code> carrying the <code>reason</code>{" "}
        and the offending <code>target</code>.
      </p>
      <CodeBlock
        language="ts"
        code={`import { safeRedirect, OpenRedirectBlockedError } from "@daloyjs/core";

// Option A: silent fallback (best UX for login flows).
return safeRedirect(next, { allowedPaths: ["/dashboard"], fallback: "/" });

// Option B: handle the rejection explicitly.
try {
  return safeRedirect(next, { allowedPaths: ["/dashboard"] });
} catch (err) {
  if (err instanceof OpenRedirectBlockedError) {
    app.log.warn({ reason: err.reason, target: err.target }, "blocked open redirect");
    return safeRedirect("/", { allowedPaths: ["/"] });
  }
  throw err;
}`}
      />
      <p>
        The <code>reason</code> is one of <code>empty-target</code>,{" "}
        <code>invalid-control-characters</code>, <code>non-latin1-target</code>,{" "}
        <code>protocol-relative</code>, <code>backslash-path</code>,{" "}
        <code>path-not-allowed</code>, <code>origin-not-allowed</code>,{" "}
        <code>scheme-not-allowed</code>, or <code>parse-failed</code>, useful for
        metrics on which attack shape you are seeing. (<code>non-latin1-target</code>{" "}
        covers same-origin paths carrying a code point above U+00FF, including
        the Unicode slash homographs.)
      </p>

      <h2 id="choosing-a-status-code">Choosing a status code</h2>
      <p>
        Override the default <code>303</code> only when you genuinely need a
        different redirect semantic. Accepted values are <code>301</code>,{" "}
        <code>302</code>, <code>303</code>, <code>307</code>, and{" "}
        <code>308</code>. You can also merge extra response headers; the{" "}
        <code>Location</code> header is always overwritten with the validated
        target.
      </p>
      <CodeBlock
        language="ts"
        code={`safeRedirect(next, {
  allowedPaths: ["/dashboard"],
  status: 307, // preserve method + body on redirect
  headers: { "X-Redirect-Source": "login" },
});`}
      />
    </>
  );
}
