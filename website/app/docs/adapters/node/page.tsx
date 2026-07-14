import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Node.js adapter",
  description:
    "Run a DaloyJS REST API on Node.js 24+ as a long-lived HTTP server. Graceful SIGTERM/SIGINT shutdown, sane request/header/keep-alive timeouts, connection-layer admission control for graceful degradation under overload, and trust-proxy controls.",
  path: "/docs/adapters/node",
  keywords: [
    "DaloyJS Node.js adapter",
    "Node 24 HTTP server",
    "graceful shutdown Node",
    "closeAllConnections",
    "keepAliveTimeout",
    "trustProxy DaloyJS",
    "maxConnections admission control",
    "graceful degradation overload",
    "tail latency cliff",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Node.js</h1>
      <p>
        The Node adapter runs your REST API on the built-in{" "}
        <code>node:http</code> server. It&apos;s the default target for
        containers, VMs, and any Node-based PaaS (Heroku, Railway, Render,
        Fly.io). Use it when you control the process, long-lived, observable,
        and easy to debug.
      </p>

      <FlowDiagram
        title="Node adapter request path"
        steps={[
          { eyebrow: "client", label: "HTTP request", detail: "TCP socket" },
          {
            eyebrow: "node:http",
            label: "serve(app)",
            detail: "timeouts · maxConnections",
            tone: "muted",
          },
          {
            eyebrow: "core",
            label: "app.fetch(Request)",
            detail: "routing · hooks · handler",
            tone: "accent",
          },
          { eyebrow: "client", label: "Response", tone: "success" },
        ]}
        caption="The adapter turns a node:http socket into a web-standard Request, applies production timeouts and optional connection-layer admission control, then hands off to app.fetch. SIGTERM and SIGINT drain in-flight requests before closing."
      />

      <h2 id="when-to-choose-node">When to choose Node</h2>
      <ul>
        <li>
          You deploy to a container, VM, or Node PaaS (no per-request billing).
        </li>
        <li>
          You need <code>node:*</code> modules (filesystem, child processes,
          native addons).
        </li>
        <li>You want the broadest npm package compatibility.</li>
      </ul>

      <h2 id="scaffold">Scaffold</h2>
      <p>
        The fastest way to start is the <code>node-basic</code> template. It
        ships with TypeScript, pnpm workspaces, a <code>/healthz</code> route,
        graceful shutdown, and Hey&nbsp;API codegen wired up.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template node-basic
cd my-api
pnpm dev    # hot-reload via daloy dev`}
      />

      <h2 id="install">Install</h2>
      <p>
        Requires <strong>Node.js 24 LTS or Node.js 26+</strong>. The adapter
        ships with <code>@daloyjs/core</code>; no extra dependency.
      </p>
      <CodeBlock language="bash" code={`pnpm add @daloyjs/core`} />

      <h2 id="minimal-server">Minimal server</h2>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app.ts";

const { port, close } = serve(app, {
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
  connectionTimeoutMs: 30_000,
  shutdownTimeoutMs: 10_000,
  handleSignals: true,       // SIGTERM / SIGINT trigger graceful shutdown
  maxHeaderBytes: 16 * 1024, // 16 KiB cap (default)
  trustProxy: false,         // set true only behind a trusted reverse proxy
  maxConnections: 200,       // optional: cap concurrent sockets (off by default)
});

console.log(\`listening on :\${port}\`);

// later - drain in-flight requests, then close
await close();`}
      />

      <h2 id="what-the-adapter-wires-for-you">
        What the adapter wires for you
      </h2>
      <ul>
        <li>
          <code>requestTimeout</code>, <code>headersTimeout</code>, and{" "}
          <code>keepAliveTimeout</code> set to safe production values. Both
          request timeouts derive from <code>connectionTimeoutMs</code>, and the
          adapter also lowers Node&apos;s connection-check interval to a
          fraction of that value so a slowloris (a client that stalls or
          trickles its request headers to hold a socket open) is reaped close to
          the deadline with a <code>408</code>, instead of surviving until
          Node&apos;s default 30&nbsp;second sweep. Set{" "}
          <code>connectionTimeoutMs: 0</code> to disable the timeouts entirely.
        </li>
        <li>
          SIGTERM / SIGINT handlers that call <code>server.close()</code>{" "}
          followed by <code>server.closeAllConnections()</code> after{" "}
          <code>shutdownTimeoutMs</code>: the pattern that became stable in Node
          18.2 and is recommended on supported Node versions.
        </li>
        <li>
          When <code>trustProxy: true</code>, the adapter reads{" "}
          <code>x-forwarded-proto</code> and <code>x-forwarded-host</code> when
          constructing the request URL. Leave it off unless TLS is terminated at
          a known proxy you control.
        </li>
      </ul>

      <h2 id="behind-a-load-balancer">Behind a load balancer</h2>
      <p>Two rules to avoid the classic 502/504 race:</p>
      <ul>
        <li>
          Make your load balancer&apos;s idle timeout <strong>greater</strong>{" "}
          than DaloyJS&apos;s <code>requestTimeoutMs</code>.
        </li>
        <li>
          Make DaloyJS&apos;s <code>keepAliveTimeout</code>{" "}
          <strong>greater</strong> than the load balancer&apos;s, the Node
          adapter does this for you.
        </li>
      </ul>

      <h2 id="graceful-degradation-under-overload">
        Graceful degradation under overload
      </h2>
      <p>
        Steady-state throughput is only half the story. Once a Node process is
        pushed <em>past</em> saturation, the multi-second part of the tail
        latency no longer lives in your handler, it lives in the{" "}
        <strong>accept queue</strong>, where overflow connections sit waiting
        for the event loop to get to them. A connection sweep makes this
        visible: at high concurrency an unbounded server&apos;s p99.9 can{" "}
        <em>cliff</em> from tens of milliseconds into the multi-second range,
        even though median throughput still looks healthy.
      </p>
      <p>
        The cheapest fix that actually works is{" "}
        <strong>connection-layer admission control</strong>:{" "}
        <code>maxConnections</code> forwards to Node&apos;s{" "}
        <code>server.maxConnections</code>, so once the cap is reached the
        server refuses additional sockets <strong>at accept time</strong>{" "}
        instead of queuing them into the event loop. Admitted traffic stays
        fast; overflow is rejected fast. It is <strong>off by default</strong>{" "}
        and sits off the request hot path, so it adds no per-request cost.
      </p>
      <CodeBlock
        language="ts"
        code={`import { serve } from "@daloyjs/core/node";
import { app } from "./app.ts";

serve(app, {
  port: 3000,
  // Keep concurrency near the process's measured sweet spot. Above this,
  // overflow sockets are refused at accept time rather than queued into
  // multi-second tail latencies. Leave unset for Node's default (unbounded).
  maxConnections: Number(process.env.MAX_CONNECTIONS ?? 200),
});`}
      />
      <p>
        Pick the cap empirically: run a connection sweep against your real
        routes and set <code>maxConnections</code> at (or just below) the
        concurrency where p99/p99.9 latency stays in its healthy range. The
        right value is workload-specific, CPU-bound JSON validation saturates at
        a very different point than I/O-bound proxying.
      </p>

      <h3 id="pair-it-with-an-upstream-gateway">
        Pair it with an upstream gateway
      </h3>
      <p>
        When the cap is hit, the overflow socket is refused at the TCP layer,
        the client sees a connection reset, not an HTTP response. In production
        you want a load balancer or API gateway in front that translates that
        refusal into a clean <code>503 Service Unavailable</code> with a{" "}
        <code>Retry-After</code> header, so well-behaved clients back off and
        retry instead of hammering a saturated process.
      </p>

      <h3 id="pair-it-with-loadshedding">Pair it with loadShedding</h3>
      <p>
        <code>maxConnections</code> and{" "}
        <Link href="/docs/security/lifecycle-leftovers">
          <code>loadShedding()</code>
        </Link>{" "}
        solve different layers of the same problem and compose well:
      </p>
      <ul>
        <li>
          <strong>
            <code>maxConnections</code>
          </strong>{" "}
          (connection layer) caps how many sockets are ever accepted, keeping
          the event loop in its measured sweet spot.
        </li>
        <li>
          <strong>
            <code>loadShedding()</code>
          </strong>{" "}
          (application layer) sheds requests when an honest overload signal,
          event-loop <em>delay</em> (queue backlog) or in-flight concurrency,
          trips a threshold.
        </li>
      </ul>
      <p>
        A note on the load-shedding signal: event-loop{" "}
        <strong>utilization</strong> is the wrong knob for an always-busy,
        CPU-bound server, which can sit near 100% utilization while perfectly
        healthy and would shed good traffic. Event-loop <strong>delay</strong>{" "}
        (how far behind the loop has fallen) is the honest overload signal.
        Likewise, <code>requestTimeoutMs</code> alone does <em>not</em> fix the
        cliff: it wraps handler execution, not the accept-queue wait where the
        multi-second tail actually lives.
      </p>
      <p>
        Treat <code>maxConnections</code> as a resilience/latency lever, not a
        throughput lever, under overload it turns &ldquo;everyone waits
        seconds&rdquo; into &ldquo;admitted traffic stays fast, overflow is
        refused fast.&rdquo;
      </p>

      <h2 id="dockerfile">Dockerfile</h2>
      <CodeBlock
        language="docker"
        code={`FROM node:24-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build

FROM gcr.io/distroless/nodejs24-debian12
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER nonroot
EXPOSE 3000
CMD ["dist/server.js"]`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          Don&apos;t put <code>process.exit()</code> in a SIGTERM handler, let{" "}
          <code>close()</code> drain. The adapter handles the hard kill after
          the timeout.
        </li>
        <li>
          Set <code>hostname: &quot;0.0.0.0&quot;</code> in containers; Node
          binds to <code>localhost</code> by default and that&apos;s invisible
          from outside the container.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/deployment/fly-io">Fly.io</Link> ·{" "}
          <Link href="/docs/deployment/render">Render</Link> ·{" "}
          <Link href="/docs/deployment/railway">Railway</Link> ·{" "}
          <Link href="/docs/deployment/heroku">Heroku</Link>
        </li>
        <li>
          <Link href="/docs/security/lifecycle-health">
            Lifecycle &amp; health
          </Link>
        </li>
      </ul>
    </>
  );
}
