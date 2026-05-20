import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Wave 4 leftovers (0.20.0)",
  description:
    "Daloy 0.20.0 ships the Wave 4 leftover slice of the secure-by-default initiative: loadShedding(), app.cspReportRoute() with secureHeaders reporting wiring, disconnectStatusCode: 499 default, and defineConfig({ schema, source }) boot-time validation.",
  path: "/docs/security/wave-4-leftovers",
  keywords: [
    "DaloyJS loadShedding",
    "under-pressure",
    "CSP report-uri",
    "Reporting-Endpoints",
    "Report-To",
    "cspReportRoute",
    "disconnectStatusCode",
    "499 client closed request",
    "defineConfig",
    "Standard Schema",
    "0.20.0",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Wave 4 leftovers (0.20.0)</h1>
      <p>
        Daloy <strong>0.20.0</strong> closes the four leftover items from Wave 4
        of the secure-by-default initiative. Each one is additive and opt-in
        (or, in the case of <code>disconnectStatusCode</code>, only changes the
        status code recorded for already-aborted requests):
      </p>
      <ul>
        <li>
          <code>loadShedding()</code> — first-party event-loop pressure monitor
          that returns <code>503 Service Unavailable</code> +{" "}
          <code>Retry-After</code> when the process is overloaded.
        </li>
        <li>
          <code>app.cspReportRoute()</code> — rate-limited POST receiver for CSP
          violation reports, plus{" "}
          <code>secureHeaders({"{ reportingEndpoints, reportTo }"})</code>{" "}
          wiring so a single line registers the endpoint and threads it back
          into the CSP header.
        </li>
        <li>
          <code>disconnectStatusCode: 499</code> default — client-aborted
          requests record <code>499</code> instead of a <code>5xx</code>, so
          dashboards separate scraper aborts from real server failures.
        </li>
        <li>
          <code>defineConfig({"{ schema, source }"})</code> — boot-time typed
          configuration validation through a Standard Schema (Zod / Valibot /
          ArkType / TypeBox), with aggregated error reporting.
        </li>
      </ul>

      <h2>
        1. <code>loadShedding()</code>
      </h2>
      <p>
        Drop-in middleware that samples event-loop delay, event-loop
        utilization, heap, and RSS through <code>node:perf_hooks</code>. When
        any configured threshold is breached, every incoming request is
        short-circuited with a structured <code>503 problem+json</code> carrying{" "}
        <code>Retry-After</code>. The sampler is <code>unref()</code>&apos;d so
        it never pins the event loop, and the whole module is a silent no-op on
        runtimes without <code>node:perf_hooks</code> (Cloudflare Workers,
        Vercel Edge, Fastly Compute) so the same line is portable.
      </p>
      <CodeBlock
        code={`import { App, loadShedding } from "@daloyjs/core";

const app = new App();
app.use(
  loadShedding({
    maxEventLoopDelayMs: 1_000,       // default 1s
    maxEventLoopUtilization: 0.98,    // default 0.98
    maxHeapUsedBytes: 512 * 1024 ** 2, // off by default
    sampleIntervalMs: 1_000,          // default 1s; clamped to >= 100
    retryAfterSeconds: 10,            // default 10
    // Optional custom check; truthy reason string sheds the request.
    healthCheck: async () => (db.isReady() ? undefined : "db.notReady"),
  }),
);`}
        language="ts"
      />
      <p>
        Defaults are off for the deployment-specific thresholds (heap, RSS) and
        conservative for everything else; tighten them once you have real
        baselines from production.
      </p>

      <h2>
        2. <code>app.cspReportRoute()</code> + <code>secureHeaders</code>{" "}
        reporting wiring
      </h2>
      <p>
        Registers a rate-limited <code>POST</code> receiver for browser CSP
        violation reports. Defaults: path <code>/__csp-report</code>, per-IP
        rate limit <code>60</code> requests / <code>60s</code>, body cap{" "}
        <code>8 KiB</code> (hard-capped at <code>64 KiB</code> since{" "}
        <code>0.30.0</code>), accepted content types{" "}
        <code>application/csp-report</code> and{" "}
        <code>application/reports+json</code>. <code>application/json</code> is
        refused with <code>415</code>.
      </p>
      <CodeBlock
        code={`import { App, secureHeaders } from "@daloyjs/core";

const app = new App();

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
    },
    // Modern Reporting-Endpoints header + legacy Report-To JSON.
    reportingEndpoints: { csp: "/__csp-report" },
    // CSP "report-to <group>" directive is appended automatically.
    reportTo: "csp",
  }),
);

app.cspReportRoute({
  path: "/__csp-report",       // default
  rateLimit: { limit: 60, windowMs: 60_000 }, // default; pass false to disable
  maxBodyBytes: 8 * 1024,      // default
  logCspReportBodies: false,   // production default; set true only after log review
  // Optional structured sink; defaults to log.warn through the redacted logger.
  onReport: (report, { ip, userAgent }) => {
    const body = report as { "csp-report"?: { "blocked-uri"?: string } };
    metrics.cspViolation.inc({ blockedUri: body["csp-report"]?.["blocked-uri"] });
  },
});`}
        language="ts"
      />
      <p>
        Bad content-types receive <code>415</code>, oversize payloads{" "}
        <code>413</code>, malformed JSON <code>400</code>, and rate-limited
        callers <code>429</code>. The default logger sink omits the parsed
        report body in production unless <code>logCspReportBodies: true</code>{" "}
        is set explicitly; CSP reports include violated URLs, and URLs are where
        PII likes to hide when nobody is looking. Sink errors are caught and
        logged at <code>error</code> through the pluggable redacted logger
        without breaking the <code>204</code> response.
      </p>

      <h2>
        3. <code>disconnectStatusCode: 499</code> default
      </h2>
      <p>
        When the client closes the connection before the response completes (the
        request <code>AbortSignal</code> fires), the dispatcher logs{" "}
        <code>{`{ event: "request.disconnected", status: 499 }`}</code> and
        returns an empty <code>499</code> response. Access-log dashboards and
        SLO alerts then cleanly separate client aborts (scrapers, aborted
        fetches, WAF-blocked retries) from real <code>5xx</code> failures.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

// Default: 499 (Nginx convention for "client closed request").
const app = new App();

// Override with any integer in [400, 499], or 0 to disable the rewrite.
const legacy = new App({ disconnectStatusCode: 0 });

// Out-of-range values refuse-at-construction:
//   new App({ disconnectStatusCode: 200 })  // throws
//   new App({ disconnectStatusCode: 500 })  // throws`}
        language="ts"
      />
      <p>
        Cannot be silenced to a <code>2xx</code> or escalated to a{" "}
        <code>5xx</code> — the value is pinned to the <code>[400, 499]</code>{" "}
        range (or <code>0</code> to keep whatever status the handler produced).
      </p>

      <h2>
        4. <code>defineConfig({"{ schema, source }"})</code>
      </h2>
      <p>
        Boot-time helper that validates the app&apos;s runtime configuration
        through a Standard Schema (Zod / Valibot / ArkType / TypeBox). Closes
        the &quot;we shipped to production with{" "}
        <code>JWT_SECRET=undefined</code> because the env var wasn&apos;t set on
        the new cluster&quot; class of bugs at the framework boundary — not at
        every middleware that consumes the secret.
      </p>
      <CodeBlock
        code={`import { defineConfig, ConfigValidationError } from "@daloyjs/core";
import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  JWT_SECRET: z.string().min(32),
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]),
});

try {
  // Sources: "env" | { kind: "env", env }
  //        | { kind: "file", path, parse? }
  //        | { kind: "object", data }
  //        | { kind: "custom", resolve }
  const config = await defineConfig({
    schema: ConfigSchema,
    source: "env",
  });
  // config is fully typed: { PORT: number, JWT_SECRET: string, ... }
  startServer(config);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    // Every offending key is listed in err.issues, and a single
    // problem-shaped summary was already written to process.stderr.
    process.exit(1);
  }
  throw err;
}`}
        language="ts"
      />
      <p>
        <code>defineConfig</code> reports <strong>every</strong> offending key
        in one pass (not just the first one) so a cold-start deploy fixes a
        misconfigured cluster on the first try. Suppress the stderr summary with{" "}
        <code>{`{ stderr: false }`}</code> if you want to handle the error
        structurally yourself.
      </p>
    </>
  );
}
