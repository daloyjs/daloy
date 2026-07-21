import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { LayerStack } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Where to use DaloyJS",
  description:
    "A beginner-friendly map of where DaloyJS fits, API server, microservice, BFF, in-app gateway, webhook receiver, WebSocket server, MCP server, and where it doesn't (SSR, load balancer, GraphQL/SOAP/gRPC servers). Plain-English definitions of every term.",
  path: "/docs/where-to-use",
  keywords: [
    "DaloyJS use cases",
    "API gateway vs BFF",
    "backend for frontend",
    "microservice framework",
    "webhook server",
    "WebSocket server",
    "MCP server",
    "gRPC vs REST",
    "GraphQL vs REST",
    "SOAP",
    "load balancer",
    "server side rendering",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Where to use DaloyJS</h1>
      <p>
        DaloyJS is a <strong>contract-first TypeScript web framework</strong>
        {". "}
        It takes an HTTP <code>Request</code> and returns a{" "}
        <code>Response</code>
        {", "}with validation, OpenAPI, security, and a typed client all wired
        in. That description fits a lot of jobs, and a few it doesn&apos;t. This
        page is the beginner&apos;s map.
      </p>

      <p>
        If you only read one thing:{" "}
        <strong>
          DaloyJS is excellent at the &quot;your code answers an HTTP
          request&quot; role</strong>
        {": "}API server, microservice, BFF, webhook receiver, WebSocket
        server, MCP server. It is <strong>not</strong> a router that proxies
        traffic to other services, a load balancer, or a page-rendering UI
        framework. For those, pair it with something purpose-built and let
        DaloyJS be the smart endpoint behind them.
      </p>

      <h2 id="the-quick-verdict">The quick verdict</h2>
      <p>For each role, here is the short answer.</p>
      <div className="not-prose my-6 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Fit</th>
              <th className="px-3 py-2">In one sentence</th>
            </tr>
          </thead>
          <tbody className="[&_tr]:border-t [&_tr]:border-border">
            <tr>
              <td className="px-3 py-2">API server</td>
              <td className="px-3 py-2">Excellent</td>
              <td className="px-3 py-2">This is the home position.</td>
            </tr>
            <tr>
              <td className="px-3 py-2">Web server (HTML, static files)</td>
              <td className="px-3 py-2">Works, but not the point</td>
              <td className="px-3 py-2">
                It can return HTML, but a CDN or Next.js is better at it.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">Microservice (one of many)</td>
              <td className="px-3 py-2">Excellent</td>
              <td className="px-3 py-2">
                Use the <code>internal-service</code> preset behind a mesh.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">Backend-for-Frontend (BFF)</td>
              <td className="px-3 py-2">Excellent</td>
              <td className="px-3 py-2">
                Typed upstream client + <code>fetchGuard</code> + sessions =
                exactly the BFF kit.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">API gateway (in-app)</td>
              <td className="px-3 py-2">Strong</td>
              <td className="px-3 py-2">
                All the edge concerns, auth, rate limit, CORS, headers, minus
                traffic proxying.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                API gateway (standalone, fronting many services)
              </td>
              <td className="px-3 py-2">Not the right tool</td>
              <td className="px-3 py-2">Use Kong, APISIX, Envoy, or Tyk.</td>
            </tr>
            <tr>
              <td className="px-3 py-2">Load balancer</td>
              <td className="px-3 py-2">No</td>
              <td className="px-3 py-2">
                Use a real LB (NGINX, HAProxy, ALB, Cloudflare).
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">Server-side renderer (SSR)</td>
              <td className="px-3 py-2">No</td>
              <td className="px-3 py-2">
                No JSX/hydration engine. Use Next.js / Remix / Astro and put
                DaloyJS behind it.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">Webhook receiver</td>
              <td className="px-3 py-2">Excellent</td>
              <td className="px-3 py-2">
                First-party HMAC verifier and signed-payload helpers.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">WebSocket server</td>
              <td className="px-3 py-2">Excellent</td>
              <td className="px-3 py-2">
                First-party <code>app.ws()</code> with CSWSH refuse-to-boot.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">MCP server (HTTP transport)</td>
              <td className="px-3 py-2">Strong</td>
              <td className="px-3 py-2">
                JSON-RPC over Streamable HTTP, DaloyJS handles the HTTP pieces;
                the MCP framing is yours.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">gRPC server</td>
              <td className="px-3 py-2">No</td>
              <td className="px-3 py-2">
                DaloyJS is web-standard HTTP REST. Use{" "}
                <code>@grpc/grpc-js</code>.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">GraphQL server</td>
              <td className="px-3 py-2">Possible, not native</td>
              <td className="px-3 py-2">
                You can mount Yoga/Apollo as a single route, but DaloyJS
                isn&apos;t a GraphQL framework.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">SOAP server</td>
              <td className="px-3 py-2">No</td>
              <td className="px-3 py-2">
                SOAP is XML/WSDL; DaloyJS speaks JSON contracts.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="plain-english-definitions">Plain-English definitions</h2>
      <p>
        Before we go role-by-role, here is what each term actually means. If
        you&apos;ve been nodding along in meetings without being sure, this is
        for you.
      </p>
      <ul>
        <li>
          <strong>API server</strong>
          {": "}a process that exposes endpoints (like
          <code>GET /books/:id</code>) over HTTP and returns structured data
          (usually JSON). The thing your mobile app, web app, or another service
          talks to.
        </li>
        <li>
          <strong>Web server</strong>
          {": "}historically, a process that serves HTML pages, images, and
          static files to a browser. NGINX and Apache are web servers. An API
          server is a specialized web server.
        </li>
        <li>
          <strong>Microservice</strong>
          {": "}one small service that does one thing (orders, payments,
          search) and talks to others over the network. &quot;Microservice
          architecture&quot; just means you have many of them instead of one big
          app.
        </li>
        <li>
          <strong>Service-to-service (S2S)</strong>
          {": "}when two of your own backend services call each other directly,
          with no human in the loop. Usually authenticated with a shared secret
          or mTLS, not a user cookie.
        </li>
        <li>
          <strong>Backend-for-Frontend (BFF)</strong>
          {": "}a thin server that sits between a specific frontend (your web
          app, your iOS app) and your internal APIs. It composes upstream calls,
          holds the session, and returns exactly the shape the UI needs.
        </li>
        <li>
          <strong>API gateway</strong>
          {": "}a process at the edge of your network that takes <em>all</em>{" "}
          incoming traffic and routes it to the right internal service. It
          usually handles auth, rate limiting, request translation, retries, and
          observability for many services at once.
        </li>
        <li>
          <strong>Load balancer</strong>
          {": "}a network-level box that takes one stream of requests and
          spreads them across many identical copies of your service. It cares
          about TCP connections and health checks, not your routes or schemas.
        </li>
        <li>
          <strong>Server-side renderer (SSR)</strong>
          {": "}a process that turns components (React, Vue, Svelte) into HTML
          on the server, then ships that HTML to the browser. Next.js, Remix,
          and Astro are SSR frameworks.
        </li>
        <li>
          <strong>Webhook receiver</strong>
          {": "}an endpoint that other systems (Stripe, GitHub, Shopify) call
          to notify your app of events. Usually signed with HMAC so you can
          verify the sender.
        </li>
        <li>
          <strong>WebSocket server</strong>
          {": "}a long-lived, bidirectional connection over TCP. Used for chat,
          live dashboards, multiplayer, collaborative editing.
        </li>
        <li>
          <strong>MCP server</strong>
          {": "}Model Context Protocol. A standardized way for AI assistants to
          call tools and read resources. Transports are stdio or Streamable
          HTTP, with optional SSE for streaming server messages.
        </li>
        <li>
          <strong>gRPC</strong>
          {": "}a binary RPC protocol from Google, defined with{" "}
          <code>.proto</code> files and running over HTTP/2 with Protobuf
          encoding. Great for fast, typed S2S inside a cluster.
        </li>
        <li>
          <strong>GraphQL</strong>
          {": "}a query language where the client picks the shape of the
          response from a single endpoint (usually
          <code>POST /graphql</code>).
        </li>
        <li>
          <strong>SOAP</strong>
          {": "}an older XML-based RPC protocol with WSDL contracts. Still
          common in banking, government, and legacy enterprise.
        </li>
      </ul>

      <h2 id="role-by-role">Role by role</h2>

      <h3 id="1-api-server-the-home-position">
        1. API server: the home position
      </h3>
      <p>
        This is what DaloyJS was designed for. You declare a route once, get
        validation, OpenAPI docs, a typed in-process client, and an
        autogenerated SDK out the other end.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ docs: true }).get(
  "/books/:id",
  {
    operationId: "getBook",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Found", body: z.object({ id: z.string(), title: z.string() }) },
    },
  },
  async ({ params }) => ({ status: 200, body: { id: params.id, title: "..." } }),
);

serve(app, { port: 3000 });`}
      />
      <p>
        See <Link href="/docs/getting-started">Getting started</Link> and{" "}
        <Link href="/docs/routing">Routing</Link>.
      </p>

      <h3 id="2-web-server-html-and-static-files">
        2. Web server (HTML and static files)
      </h3>
      <p>
        DaloyJS can return any <code>Response</code>
        {", "}so you <em>can</em> serve HTML or files from it. But:
      </p>
      <ul>
        <li>There&apos;s no file-system routing for pages.</li>
        <li>There&apos;s no asset pipeline or hydration.</li>
        <li>A CDN will serve static files faster and cheaper.</li>
      </ul>
      <p>
        The only HTML DaloyJS ships out of the box is the Scalar / Swagger docs
        page at <code>/docs</code>
        {". "}For real web content, put a CDN, a static host, or Next.js in
        front and let DaloyJS be the JSON layer.
      </p>

      <h3 id="3-microservice-one-of-many">3. Microservice (one of many)</h3>
      <p>
        DaloyJS is a strong fit here, with one small twist: when a service runs
        behind a mesh, sidecar, or private network, you don&apos;t need the
        browser-only protections like CSRF and same-origin enforcement. The
        framework ships a preset for exactly this case.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";

const app = new App({
  preset: "internal-service", // turn off browser guards, keep input/parser/credential guards on
});`}
      />
      <p>
        See{" "}
        <Link href="/docs/security/internal-service-preset">
          Internal services &amp; meshes
        </Link>{" "}
        and{" "}
        <Link href="/docs/architecture/modular-monolith">Modular monolith</Link>{" "}
        (you don&apos;t need a fleet of services to start).
      </p>

      <h3 id="4-backend-for-frontend-bff-the-sweet-spot">
        4. Backend-for-Frontend (BFF): the sweet spot
      </h3>
      <p>
        BFF is arguably where DaloyJS is at its best. The combination you want
        is all first-party:
      </p>
      <ul>
        <li>
          <strong>Typed upstream calls</strong> via Hey API codegen or the
          in-process typed client.
        </li>
        <li>
          <strong>Safe egress</strong> via{" "}
          <Link href="/docs/security/fetch-guard">
            <code>fetchGuard()</code>
          </Link>
          {": "}blocks SSRF, private CIDRs, and cloud-metadata IPs by default.
        </li>
        <li>
          <strong>Session edge</strong> via{" "}
          <Link href="/docs/security/session">
            <code>session()</code>
          </Link>{" "}
          (signed cookies, pluggable stores) and{" "}
          <Link href="/docs/security/csrf">
            <code>csrf()</code>
          </Link>{" "}
          (double-submit or tokenless Fetch-Metadata).
        </li>
        <li>
          <strong>Streaming to the browser</strong> via SSE and NDJSON helpers,
          plus <code>compression()</code> with BREACH-aware guards.
        </li>
        <li>
          <strong>Edge runtimes</strong>
          {": "}deploy on Cloudflare, Vercel, Fastly Compute, or Lambda.
        </li>
      </ul>
      <p>
        Pattern: your Next.js / React Native / iOS app talks only to the BFF;
        the BFF fans out to internal services and returns exactly what the UI
        needs.
      </p>

      <h3 id="5-api-gateway-strong-as-in-app-gateway-not-a-replacement-for-kong">
        5. API gateway, strong as &quot;in-app gateway&quot;, not a replacement
        for Kong
      </h3>
      <p>DaloyJS gives you almost everything an API gateway does:</p>
      <ul>
        <li>
          AuthN/Z: <code>bearerAuth</code>
          {", "}<code>basicAuth</code>
          {", "}
          <code>jwt</code>
          {", "}<code>jwk</code>
          {", "}<code>requireScopes</code>
        </li>
        <li>
          Traffic: <code>rateLimit</code> (with Redis store),{" "}
          <code>loadShedding</code>
          {", "}<code>ipRestriction</code>
        </li>
        <li>
          Edge: <code>secureHeaders</code>
          {", "}<code>cors</code>
          {", "}<code>csrf</code>
          {", "}<code>compression</code>
          {", "}<code>etag</code>
          {", "}<code>requestId</code>
        </li>
        <li>
          Egress: <code>fetchGuard</code> (SSRF defaults)
        </li>
        <li>Errors: RFC 9457 problem+json with prod redaction</li>
      </ul>
      <p>
        What it does <strong>not</strong> do (and shouldn&apos;t):
      </p>
      <ul>
        <li>
          No dynamic upstream proxy. There is no{" "}
          <code>proxyTo(&quot;http://upstream&quot;)</code>; every route binds
          to in-process code.
        </li>
        <li>
          No service discovery, circuit breakers, canary / weighted routing, or
          traffic mirroring.
        </li>
        <li>No protocol translation (gRPC ↔ REST, SOAP ↔ REST).</li>
        <li>No declarative gateway config (YAML, CRDs, admin API).</li>
      </ul>
      <p>
        <strong>Use it as:</strong> the smart edge inside one service, or the
        front door for a small set of services you also own.{" "}
        <strong>Don&apos;t use it as:</strong> the only gateway sitting in front
        of a fleet of polyglot microservices. For that, run Kong / APISIX / Tyk
        / Envoy and put DaloyJS services <em>behind</em> it.
      </p>

      <h3 id="6-load-balancer-no">6. Load balancer: no</h3>
      <p>
        Load balancing is a TCP-level job. Use NGINX, HAProxy, AWS ALB/NLB, GCP
        Load Balancing, or Cloudflare. DaloyJS sits <em>behind</em> the LB and
        serves requests; it doesn&apos;t distribute them. The framework does
        ship a <code>behindProxy</code> declarative model so it correctly reads
        <code>X-Forwarded-*</code> headers when the LB terminates TLS.
      </p>

      <h3 id="7-server-side-renderer-ssr-no">
        7. Server-side renderer (SSR): no
      </h3>
      <p>
        There is no JSX, React, Vue, or Svelte renderer in DaloyJS. No
        <code>renderToString</code>
        {", "}no hydration, no file-system page router, no React Server
        Components. The framework deliberately stays in the REST/WS layer.
      </p>
      <p>
        <strong>Recommended pattern:</strong> Next.js / Remix / Astro for SSR,
        DaloyJS for the API behind it. On Vercel you can even mount the same
        DaloyJS app as a Next.js route handler, see{" "}
        <Link href="/docs/adapters/vercel">the Vercel adapter</Link>.
      </p>

      <h3 id="8-webhook-receiver-excellent">8. Webhook receiver: excellent</h3>
      <p>Webhooks are just HTTP POSTs with a signature header. DaloyJS has:</p>
      <ul>
        <li>
          <code>verifyWebhookSignature</code> / <code>signWebhookPayload</code>
          {": "}
          zero-knob HMAC helpers
        </li>
        <li>
          <code>timingSafeEqual</code> for signature comparison
        </li>
        <li>Schema validation on the body</li>
        <li>
          Body-size limits and prototype-pollution-safe JSON enforced by the
          core
        </li>
        <li>RFC 9457 error responses that webhook senders can parse</li>
      </ul>

      <h3 id="9-websocket-server-excellent-with-cswsh-guard">
        9. WebSocket server: excellent, with CSWSH guard
      </h3>
      <p>
        First-party WebSocket primitives run on the Node and Bun adapters with a
        Bun-style handler shape (<code>open</code>
        {", "}<code>message</code>
        {", "}
        <code>close</code>
        {", "}<code>drain</code>
        {", "}<code>error</code>).
      </p>
      <p>
        Under <code>secureDefaults</code>
        {", "}the framework{" "}
        <strong>refuses to register a WebSocket route</strong> unless you
        provide either a pre-upgrade authorization hook or explicitly opt out,{" "}
        <strong>and</strong> either an Origin allowlist or an explicit
        acknowledgement. That closes the Cross-Site WebSocket Hijacking (CSWSH)
        class of bug, cookie auth alone does not protect a WebSocket handshake.
      </p>
      <p>
        See <Link href="/docs/websocket">WebSocket primitives</Link>.
      </p>

      <h3 id="10-mcp-server-http-transport-strong">
        10. MCP server (HTTP transport): strong
      </h3>
      <p>
        The Model Context Protocol is JSON-RPC 2.0, transported over either
        stdio or Streamable HTTP. Streamable HTTP uses POST and GET requests,
        and can use Server-Sent Events when the server needs to stream multiple
        messages. DaloyJS handles the HTTP/SSE building blocks natively:
      </p>
      <ul>
        <li>
          Routes for <code>POST /</code> (JSON-RPC requests) and SSE streaming
          back
        </li>
        <li>Schema validation on every request</li>
        <li>Bearer auth + scopes for tool authorization</li>
        <li>
          <code>fetchGuard</code> for any tool that makes outbound HTTP
        </li>
        <li>
          Streaming helpers at <code>@daloyjs/core/streaming</code>
        </li>
      </ul>
      <p>
        You bring the MCP framing (initialize, tools/list, tools/call) on top.
        DaloyJS won&apos;t generate it for you, there&apos;s no{" "}
        <code>defineTool()</code> primitive yet, but the HTTP, validation,
        bearer-auth, scopes, and SSE pieces are in-box. For public remote MCP
        servers, implement the MCP authorization metadata and OAuth flow on top.
      </p>

      <h3 id="11-grpc-server-no">11. gRPC server: no</h3>
      <p>
        gRPC needs HTTP/2 with Protobuf framing and trailers. DaloyJS is a REST
        framework around web-standard <code>Request</code> /{" "}
        <code>Response</code>
        {". "}It does not implement Protobuf framing, trailers, or generated
        service stubs. For gRPC, use <code>@grpc/grpc-js</code> or Connect. You
        can run a DaloyJS REST gateway in front of a gRPC backend if you want
        the external surface to be JSON.
      </p>

      <h3 id="12-graphql-server-possible-not-the-framework-and-apos-s-shape">
        12. GraphQL server: possible, not the framework&apos;s shape
      </h3>
      <p>
        DaloyJS is contract-first REST: one route, one schema, one OpenAPI
        operation. GraphQL is one route, one schema, many shapes. They&apos;re
        philosophically different.
      </p>
      <p>
        If you must, you can mount GraphQL Yoga, Apollo, or Mercurius as a
        single <code>POST /graphql</code> route handler. You&apos;ll lose
        OpenAPI/typed-client benefits for that route. For new projects, either
        commit to REST (and use DaloyJS) or commit to GraphQL (and use a GraphQL
        framework).
      </p>

      <h3 id="13-soap-server-no">13. SOAP server: no</h3>
      <p>
        SOAP is XML-over-HTTP with WSDL contracts. DaloyJS speaks JSON contracts
        via Standard Schema. There is no built-in XML parser, no WSDL generator,
        no SOAP envelope helper. If you have a legacy SOAP client that must talk
        to you, the practical pattern is: put a small adapter (Java, .NET, or a
        Node SOAP library like <code>strong-soap</code>) in front, and let it
        translate to a clean DaloyJS REST API behind.
      </p>

      <h2 id="cheat-sheet-pick-the-right-tool">
        Cheat sheet: pick the right tool
      </h2>
      <div className="not-prose my-6 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2">If your problem is…</th>
              <th className="px-3 py-2">Reach for…</th>
              <th className="px-3 py-2">Why not DaloyJS?</th>
            </tr>
          </thead>
          <tbody className="[&_tr]:border-t [&_tr]:border-border">
            <tr>
              <td className="px-3 py-2">
                Distribute traffic across N copies of a service
              </td>
              <td className="px-3 py-2">NGINX, HAProxy, ALB, Cloudflare</td>
              <td className="px-3 py-2">
                DaloyJS is the workload, not the router.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                One front door for 30 polyglot services
              </td>
              <td className="px-3 py-2">Kong, APISIX, Envoy, Tyk</td>
              <td className="px-3 py-2">
                No dynamic upstream proxy or service discovery.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                Render React/Vue pages on the server
              </td>
              <td className="px-3 py-2">Next.js, Remix, Astro, Nuxt</td>
              <td className="px-3 py-2">No component renderer or hydration.</td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                Binary, typed, fast S2S RPC inside a cluster
              </td>
              <td className="px-3 py-2">gRPC, Connect</td>
              <td className="px-3 py-2">
                No Protobuf/trailer-native RPC stack.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                Single endpoint, client picks the response shape
              </td>
              <td className="px-3 py-2">GraphQL Yoga, Apollo</td>
              <td className="px-3 py-2">
                Different paradigm; DaloyJS is one-route-per-operation.
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                Old enterprise integration over XML/WSDL
              </td>
              <td className="px-3 py-2">
                A dedicated SOAP stack (or a translation adapter)
              </td>
              <td className="px-3 py-2">No XML/WSDL primitives.</td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                JSON API, validated, documented, secure
              </td>
              <td className="px-3 py-2">
                <strong>DaloyJS</strong>
              </td>
              <td className="px-3 py-2">-</td>
            </tr>
            <tr>
              <td className="px-3 py-2">Webhook receiver with HMAC</td>
              <td className="px-3 py-2">
                <strong>DaloyJS</strong>
              </td>
              <td className="px-3 py-2">-</td>
            </tr>
            <tr>
              <td className="px-3 py-2">
                BFF that composes internal APIs for one UI
              </td>
              <td className="px-3 py-2">
                <strong>DaloyJS</strong>
              </td>
              <td className="px-3 py-2">-</td>
            </tr>
            <tr>
              <td className="px-3 py-2">Real-time chat / dashboards over WS</td>
              <td className="px-3 py-2">
                <strong>DaloyJS</strong>
              </td>
              <td className="px-3 py-2">-</td>
            </tr>
            <tr>
              <td className="px-3 py-2">MCP server over Streamable HTTP</td>
              <td className="px-3 py-2">
                <strong>DaloyJS</strong> (you bring the MCP framing)
              </td>
              <td className="px-3 py-2">-</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="a-common-deployment-shape">A common deployment shape</h2>
      <p>
        Most real systems use several of these tools together. A typical
        production layout looks like this:
      </p>

      <LayerStack
        title="Where DaloyJS sits"
        layers={[
          {
            title: "Browser / Mobile app",
            detail: "the clients",
            tone: "muted",
          },
          {
            title: "CDN",
            detail: "static assets, images",
            tone: "muted",
          },
          {
            title: "Load balancer",
            detail: "NGINX, ALB, Cloudflare",
            tone: "muted",
          },
          {
            title: "API gateway (optional)",
            detail: "Kong, APISIX, Envoy for many services",
            tone: "muted",
          },
          {
            title: "DaloyJS services",
            detail: "same framework, configured per role",
            items: [
              "BFF",
              "Catalog API",
              "Orders API",
              "Webhooks",
              "WebSocket",
              "MCP",
            ],
            tone: "accent",
          },
        ]}
        caption="Every box marked DaloyJS is the same framework with the same contract style and security defaults. The layers above it exist because they are better at their specific job (traffic, routing, static assets)."
      />

      <CodeBlock
        language="text"
        code={`Browser / Mobile app
        │
        ▼
[ CDN ] ──> static assets, images
        │
        ▼
[ Load balancer ]              ← NGINX / ALB / Cloudflare
        │
        ▼
[ API gateway ]                ← Kong / APISIX / Envoy (optional, for many services)
        │
        ├──> [ BFF - DaloyJS ]            ← session, CSRF, fetchGuard, typed upstream client
        │           │
        │           ├──> [ Catalog API - DaloyJS, internal-service preset ]
        │           ├──> [ Orders API  - DaloyJS, internal-service preset ]
        │           └──> [ Search API  - could be gRPC, GraphQL, anything ]
        │
        ├──> [ Webhook receiver - DaloyJS ] ← Stripe, GitHub, Shopify
        │
        ├──> [ WebSocket server - DaloyJS ] ← live updates
        │
        └──> [ MCP server - DaloyJS ]       ← AI assistants call tools here`}
      />
      <p>
        Every box marked <em>DaloyJS</em> is the same framework, the same
        contract style, the same security defaults, just configured for its
        role. The boxes that aren&apos;t DaloyJS exist because they&apos;re
        better at their specific job.
      </p>

      <h2 id="where-to-go-next">Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/getting-started">
            Build your first DaloyJS route
          </Link>
        </li>
        <li>
          <Link href="/docs/security/internal-service-preset">
            Run as a microservice behind a mesh
          </Link>
        </li>
        <li>
          <Link href="/docs/security/fetch-guard">
            Wire up <code>fetchGuard</code> for a BFF
          </Link>
        </li>
        <li>
          <Link href="/docs/websocket">Add WebSocket routes safely</Link>
        </li>
        <li>
          <Link href="/docs/streaming">Stream JSON or SSE to the browser</Link>
        </li>
        <li>
          <Link href="/docs/adapters">Pick the right runtime adapter</Link>
        </li>
      </ul>
    </>
  );
}
