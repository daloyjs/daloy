import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Lifecycle & health",
  description:
    "Daloy ships connection-draining shutdown with Connection: close, crash-on-unhandled-rejection in production, and app.healthcheck() / app.readinesscheck() primitives that refuse-to-boot in production without an explicit auth or unauthenticated acknowledgement.",
  path: "/docs/security/lifecycle-health",
  keywords: [
    "DaloyJS shutdown",
    "graceful shutdown",
    "connection draining",
    "crashOnUnhandledRejection",
    "healthcheck",
    "readinesscheck",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Lifecycle &amp; health</h1>
      <blockquote>
        <strong>Think of it like…</strong> closing a kitchen at the end of the
        night. Finish the orders already on the stove (drain in-flight
        requests), turn off the burners safely (graceful shutdown with
        <code>Connection: close</code>), and put a &quot;closed&quot; sign on
        the door (<code>healthcheck</code>/<code>readinesscheck</code>) so the
        next courier knows to come back later, not to hammer on the locked door.
      </blockquote>
      <p>
        Daloy ships the lifecycle & health slice of the secure-by-default
        initiative: connection-draining shutdown, crash-on-unhandled-rejection,
        and first-class <code>healthcheck()</code> /{" "}
        <code>readinesscheck()</code> primitives. All three default-on the safe
        behaviour and let you opt out per-feature or globally with{" "}
        <code>
          app({"{"} secureDefaults: false {"}"})
        </code>
        .
      </p>

      <h2 id="1-connection-draining-shutdown">1. Connection-draining shutdown</h2>

      <FlowDiagram
        title="Draining in-flight requests on shutdown"
        numbered
        steps={[
          {
            eyebrow: "signal",
            label: "app.close(timeoutMs)",
            detail: "drain flag flips synchronously",
          },
          {
            eyebrow: "new traffic",
            label: "New requests rejected",
            detail: "503 + retry-after: 5 + connection: close",
            tone: "danger",
          },
          {
            eyebrow: "in-flight",
            label: "Existing responses finish",
            detail: "gain connection: close header",
            tone: "accent",
          },
          {
            eyebrow: "drained",
            label: "onClose hooks run",
            detail: "idle keep-alive sockets killed",
            tone: "success",
          },
        ]}
        caption="During the drain window new requests get a structured 503 while in-flight responses are allowed to finish, then onClose hooks run. The connection: close header stops HTTP/1.1 load balancers from reusing the socket."
      />

      <p>
        <code>app.shutdown(timeoutMs, reason?)</code> (alias{" "}
        <code>app.close()</code>) flips a drain flag synchronously. Every
        subsequent request returns a structured{" "}
        <code>503 application/problem+json</code> with{" "}
        <code>retry-after: 5</code> and <code>connection: close</code>. Any
        in-flight response that finishes during the drain window also gains{" "}
        <code>connection: close</code> so HTTP/1.1 load balancers stop reusing
        the keep-alive socket.
      </p>
      <CodeBlock
        code={`const app = new App({ env: "production" });

// Trigger a graceful shutdown - drain in-flight for up to 10s, then run onClose hooks.
await app.close(10_000, "SIGTERM");

// New requests during the drain window:
//   HTTP/1.1 503 Service Unavailable
//   content-type: application/problem+json
//   retry-after: 5
//   connection: close`}
      />
      <p>
        On the Node adapter, <code>serve(app)</code> registers an
        idle-connection close hook that calls{" "}
        <code>server.closeIdleConnections()</code> the moment draining begins,
        keep-alive sockets without an in-flight request are killed immediately,
        without affecting sockets that are still serving a request. Custom
        adapters can register the same hook via{" "}
        <code>app._registerIdleConnectionCloseHook(hook)</code>.
      </p>

      <h2 id="2-crash-on-unhandled-rejection-in-production">2. Crash on unhandled rejection in production</h2>
      <p>
        The new{" "}
        <code>
          app({"{"} crashOnUnhandledRejection {"}"})
        </code>{" "}
        option installs process-wide listeners for{" "}
        <code>unhandledRejection</code> and <code>uncaughtException</code> that
        log <code>fatal</code> through the pluggable logger and call{" "}
        <code>process.exit(1)</code>. The framework deliberately avoids the
        &quot;swallow and keep running&quot; anti-pattern, a crashed process is
        easier to reason about than a zombie one. Defaults:
      </p>
      <ul>
        <li>
          Omitted: install in production (
          <code>env: &quot;production&quot;</code> or{" "}
          <code>NODE_ENV === &quot;production&quot;</code>), skip elsewhere.
        </li>
        <li>
          <code>true</code>: install even in development (useful for staging /
          CI).
        </li>
        <li>
          <code>false</code>: never install, even in production.
        </li>
      </ul>
      <p>
        A process-wide latch ensures the listeners are installed exactly once
        even when multiple <code>App</code> instances boot in the same process.
        No-op on runtimes without <code>process.on</code> (Cloudflare Workers,
        Vercel, Fastly Compute).
      </p>

      <h2 id="3-app-healthcheck-and-app-readinesscheck">
        3. <code>app.healthcheck()</code> and <code>app.readinesscheck()</code>
      </h2>
      <p>
        Opt-in route registration with sensible defaults: paths{" "}
        <code>/healthz</code> and <code>/readyz</code>, per-IP fixed-window rate
        limit (60 requests / 60 s, in-memory), optional bearer-token auth
        compared via <code>timingSafeEqual</code>. Readiness returns{" "}
        <code>503</code> with <code>retry-after: 5</code> while draining{" "}
        <strong>or</strong> while any plugin is still pending in{" "}
        <code>register()</code>.
      </p>
      <CodeBlock
        code={`const app = new App({ env: "production" });

// Unauthenticated probes refuse-to-boot in production:
app.healthcheck();
// Error: app.healthcheck() refused in production: provide opts.token to require
// Authorization: Bearer <token>, or pass acknowledgeUnauthenticated: true ...

// Token-required (recommended for public clusters):
app.healthcheck({ token: process.env.HEALTH_TOKEN! });
app.readinesscheck({ token: process.env.HEALTH_TOKEN! });

// Or acknowledge the surface is internal and unauthenticated is fine:
app.healthcheck({ acknowledgeUnauthenticated: true });
app.readinesscheck({
  path: "/__ready",
  acknowledgeUnauthenticated: true,
  rateLimit: { limit: 120, windowMs: 60_000 },
});`}
      />
      <p>
        Pass <code>rateLimit: false</code> to disable the per-IP cap entirely
        (sidecar-only probes that arrive directly from the orchestrator). The
        limiter deliberately does <strong>not</strong> honour{" "}
        <code>X-Forwarded-For</code>: probes typically arrive from a sidecar so
        spoofing the header should not bypass the cap.
      </p>

      <h2 id="opt-out">Opt-out</h2>
      <p>
        Disable the whole slice with{" "}
        <code>
          new App({"{"} secureDefaults: false {"}"})
        </code>
        , or just the crash handlers with{" "}
        <code>
          new App({"{"} crashOnUnhandledRejection: false {"}"})
        </code>
        . Health and readiness routes are opt-in, no auto-registration happens,
        the framework only flips behaviour when you call{" "}
        <code>app.healthcheck()</code> / <code>app.readinesscheck()</code>{" "}
        explicitly.
      </p>
    </>
  );
}
