import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "WAF-lite signature/anomaly inspection",
  description:
    "Add a first-party, opt-in defense-in-depth WAF-lite layer with waf() — wire DaloyJS' SQLi, XSS, NoSQL-operator, and command-injection signatures into a single scored inbound-inspection middleware with per-rule enable/disable and a block-or-log mode. Not a replacement for an edge WAF. Zero runtime dependencies.",
  path: "/docs/waf",
  keywords: [
    "WAF",
    "WAF-lite",
    "web application firewall",
    "OWASP CRS",
    "SQL injection",
    "XSS",
    "NoSQL injection",
    "command injection",
    "anomaly scoring",
    "defense in depth",
    "DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>WAF-lite signature/anomaly inspection</h1>
      <p>
        A full Web Application Firewall belongs at your <strong>edge</strong> — a
        CDN, reverse proxy, or ModSecurity with the OWASP Core Rule Set. DaloyJS
        does not try to replace that. But plenty of teams ship without an edge
        WAF, and for them <code>waf()</code> is a first-party,{" "}
        <strong>opt-in defense-in-depth</strong> layer: it wires the
        framework&apos;s high-confidence injection signatures into a single,
        scored inbound-inspection pass you can turn on with one line.
      </p>
      <p>
        As of <strong>0.37.0</strong>, <code>waf()</code> inspects the decoded
        URL path, the raw and decoded query string, an optional header
        allowlist, and the validated request body for four rule categories —{" "}
        <strong>SQLi</strong>, <strong>XSS</strong>, <strong>NoSQLi</strong>{" "}
        (Mongo-style operator injection), and <strong>command injection</strong>.
        Each rule that fires contributes an <em>anomaly score</em>; when the
        total reaches the threshold, the request is rejected with a generic{" "}
        <code>403</code> (block mode) or merely reported (log mode).
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        language="ts"
        code={`import { App, waf } from "@daloyjs/core";

const app = new App();

// Register globally. Secure defaults: all four rules on, block mode,
// path/query/body inspected (headers are opt-in).
app.use(waf());`}
      />
      <p>
        The middleware runs in the <code>beforeHandle</code> phase, so it sees
        the validated context — <code>query</code>, <code>params</code>,{" "}
        <code>headers</code>, and the schema-parsed <code>body</code>. Because
        body inspection reads <code>ctx.body</code>, it composes with the
        framework&apos;s schema-first contract: routes that declare a body schema
        are body-inspected automatically.
      </p>

      <h2>Tune in log mode first</h2>
      <p>
        Signatures are curated for a low false-positive rate, but every app is
        different. Start in <code>&quot;log&quot;</code> mode, watch{" "}
        <code>onMatch</code> against real traffic, then switch to{" "}
        <code>&quot;block&quot;</code> once you are confident.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(waf({
  mode: "log", // never rejects — only reports
  onMatch: (event) => {
    logger.warn({ waf: event }, "waf detection");
    // event = { mode, action, method, path, clientIp, score, threshold, matches }
  },
}));`}
      />
      <p>
        <code>onMatch</code> fires once per <em>actionable</em> detection (score
        at or above the threshold) in both modes, immediately before any{" "}
        <code>403</code> is thrown. Each entry in <code>event.matches</code>{" "}
        carries the <code>ruleId</code>, the <code>score</code> it contributed,
        the <code>location</code> it matched (<code>path</code>,{" "}
        <code>query</code>, <code>header</code>, or <code>body</code>), and a
        short, control-character-stripped <code>sample</code> for your logs.
      </p>

      <h2>The rules</h2>
      <ul>
        <li>
          <strong>sqli</strong> — <code>UNION SELECT</code>, boolean tautologies
          (<code>OR 1=1</code>), stacked statements (
          <code>; DROP TABLE</code>), time-based probes (<code>SLEEP()</code>,{" "}
          <code>WAITFOR DELAY</code>), <code>INFORMATION_SCHEMA</code>,{" "}
          <code>xp_cmdshell</code>, and file primitives.
        </li>
        <li>
          <strong>xss</strong> — <code>&lt;script&gt;</code> tags,{" "}
          <code>javascript:</code> URIs, inline event handlers (
          <code>onerror=</code>, <code>onload=</code>), and{" "}
          <code>document.cookie</code> exfiltration.
        </li>
        <li>
          <strong>nosqli</strong> — Mongo operator strings (<code>$ne</code>,{" "}
          <code>$where</code>, …) <em>and</em> a structural check that rejects a
          parsed body containing any <code>$</code>-prefixed key, so{" "}
          <code>{`{"password": {"$ne": null}}`}</code> is caught even when no
          string value matches.
        </li>
        <li>
          <strong>cmdi</strong> — shell metacharacters chaining into binaries (
          <code>; rm</code>, <code>| nc</code>, <code>&amp;&amp; curl</code>),
          command substitution (<code>$(...)</code>, backticks), and sensitive
          path access (<code>/etc/passwd</code>).
        </li>
      </ul>

      <h2>Scoring and the block threshold</h2>
      <p>
        Each rule contributes its score <strong>once per request</strong>
        (deduplicated across all inspected locations). The default score is{" "}
        <code>5</code> and the default <code>blockThreshold</code> is{" "}
        <code>5</code>, so any single high-confidence signature trips the guard.
        Raise the threshold to require multiple independent categories before
        acting:
      </p>
      <CodeBlock
        language="ts"
        code={`// Require two independent rule categories (5 + 5 = 10 >= 8) to fire.
app.use(waf({ blockThreshold: 8 }));

// Reweight a single rule.
app.use(waf({ rules: { sqli: { score: 8 } } }));`}
      />

      <h2>Per-rule enable/disable</h2>
      <p>
        Disable a noisy rule with a boolean, or pass an object to enable it with
        a custom score. Omitted rules keep their defaults (enabled, score 5).
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(waf({
  rules: {
    xss: false,            // turn XSS inspection off entirely
    sqli: { score: 8 },    // keep SQLi on, weighted higher
    // nosqli and cmdi keep their defaults
  },
}));`}
      />

      <h2>Inspection scope</h2>
      <p>
        Path, query, and body are inspected by default. Header inspection is{" "}
        <strong>opt-in</strong> and requires an explicit allowlist, because
        common headers (<code>User-Agent</code>, <code>Cookie</code>,{" "}
        <code>Referer</code>) carry punctuation that can trip signatures.
      </p>
      <CodeBlock
        language="ts"
        code={`app.use(waf({
  inspect: {
    path: true,
    query: true,
    body: true,
    headers: ["referer", "x-forwarded-host"], // only these headers are scanned
  },
}));`}
      />
      <p>
        Scanning is bounded so a hostile payload cannot turn inspection into
        CPU-DoS: <code>maxValueLength</code> (default <code>8192</code>) caps the
        length of any single scanned string, and <code>maxBodyNodes</code>{" "}
        (default <code>10000</code>) caps how many body nodes are walked. Only
        own enumerable properties are followed — prototype keys are never
        inspected.
      </p>

      <h2>Security notes</h2>
      <ul>
        <li>
          The <code>403</code> body is intentionally generic (
          <code>Request blocked by security policy</code>) — it never tells an
          attacker which signature fired. Rule detail is delivered server-side
          via <code>onMatch</code> only.
        </li>
        <li>
          This is a <strong>complement</strong> to input schemas and parameter
          binding, not a substitute. Keep validating with Zod schemas; the WAF
          is a second line for traffic that slips through application logic.
        </li>
        <li>
          Routes without a body schema are not body-inspected (their body is
          never parsed). Add a schema to bring their inputs under coverage.
        </li>
        <li>
          A WAF-lite is best-effort signature matching: determined attackers can
          craft evasions. Treat it as depth, and keep an edge WAF on your
          roadmap for high-risk surfaces.
        </li>
      </ul>
    </>
  );
}
