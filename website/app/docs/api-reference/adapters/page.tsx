import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference: Runtime adapters",
  description:
    "DaloyJS runtime adapter reference: serve() for Node.js, Bun, and Deno, plus fetch-handler adapters for Cloudflare Workers, Vercel, Fastly Compute, and AWS Lambda.",
  path: "/docs/api-reference/adapters",
  keywords: [
    "DaloyJS adapters API",
    "DaloyJS serve reference",
    "DaloyJS Lambda adapter",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference: Runtime adapters</h1>
      <p>
        The runtime adapters wrap the same <code>app.fetch(Request)</code>{" "}
        dispatch for each platform. They are available <em>only</em> as subpaths
        (never from the root barrel), so runtime-specific code such as{" "}
        <code>node:http</code> never leaks into an edge or Worker bundle. For
        guide-level setup per platform, see the{" "}
        <Link href="/docs/adapters">adapters overview</Link>; for the module
        map, see the{" "}
        <Link href="/docs/api-reference">API reference overview</Link>.
      </p>

      <BranchDiagram
        title="One app, every runtime"
        source={{
          eyebrow: "web-standard core",
          label: "app.fetch(request)",
          detail: "Request -> Response",
        }}
        branches={[
          {
            eyebrow: "servers",
            label: "serve(app)",
            detail: "/node · /bun · /deno",
          },
          {
            eyebrow: "edge & serverless",
            label: "toFetchHandler(app)",
            detail: "/cloudflare · /vercel · /fastly",
          },
          {
            eyebrow: "aws",
            label: "toLambdaHandler(app)",
            detail: "/lambda (APIGW v1 + v2)",
          },
        ]}
        converge={{
          eyebrow: "same behavior",
          label: "Response",
          detail: "identical headers, errors, and docs everywhere",
        }}
        caption="Adapters translate each platform's entrypoint into the same web-standard dispatch, so behavior stays identical across runtimes."
      />

      <h2 id="daloyjs-core-node">
        <code>@daloyjs/core/node</code>
      </h2>
      <CodeBlock
        code={`serve(app: App, opts?: NodeServerOptions): NodeServerHandle;

interface NodeServerOptions {
  port?:                 number;   // default: 3000
  hostname?:             string;   // default: "0.0.0.0"
  connectionTimeoutMs?:  number;   // default: 30_000
  shutdownTimeoutMs?:    number;   // default: 10_000
  handleSignals?:        boolean;  // default: true (SIGINT/SIGTERM)
  maxHeaderBytes?:       number;   // default: 16 KiB
  trustProxy?:           boolean;  // honor x-forwarded-proto/host (only behind a trusted LB)
  maxConnections?:       number;   // cap concurrent sockets (admission control); default: unset (unbounded)
  bufferedBodyMaxBytes?: number;   // default: 256 KiB (pre-buffer threshold for POST hot path)
}
interface NodeServerHandle { server: Server; port: number; close(): Promise<void> }`}
      />
      <p>
        Pass <code>port: 0</code> when a test needs an ephemeral port. Because
        Node binds asynchronously, wait for the server&apos;s{" "}
        <code>listening</code> event before reading <code>handle.port</code>; it
        then reports the OS-assigned port instead of <code>0</code>.
      </p>
      <CodeBlock
        code={`import { once } from "node:events";

const handle = serve(app, { port: 0, handleSignals: false });
await once(handle.server, "listening");

const baseUrl = \`http://127.0.0.1:\${handle.port}\`;`}
      />

      <h2 id="daloyjs-core-bun">
        <code>@daloyjs/core/bun</code>
      </h2>
      <CodeBlock
        code={`serve(app: App, opts?: BunServeOptions): BunServerHandle;

interface BunServeOptions {
  port?:               number;
  hostname?:           string;
  maxRequestBodySize?: number;  // default: 16 MiB
  idleTimeout?:        number;
  development?:        boolean;
  unix?:               string;
  tls?:                BunTLSOptions;
}
interface BunServerHandle { port: number; url: URL | undefined; stop(): Promise<void> }`}
      />

      <h2 id="daloyjs-core-deno">
        <code>@daloyjs/core/deno</code>
      </h2>
      <CodeBlock
        code={`serve(app: App, opts?: DenoServeOptions): DenoServerHandle;

interface DenoServeOptions {
  port?: number; hostname?: string;
  signal?: AbortSignal;
  cert?: string; key?: string;                   // HTTPS pair
  onListen?: (info: { hostname: string; port: number }) => void;
  onError?:  (err: unknown) => Response | Promise<Response>;
  handleSignals?: boolean;                       // default: true
  shutdownTimeoutMs?: number;                    // default: 10_000
}
interface DenoServerHandle { shutdown(): Promise<void> }`}
      />

      <h2 id="daloyjs-core-cloudflare">
        <code>@daloyjs/core/cloudflare</code>
      </h2>
      <CodeBlock
        code={`toFetchHandler<Env = unknown>(app: App): ExportedFetchHandler<Env>;
  // export default toFetchHandler(app);

interface ExportedFetchHandler<Env = unknown> {
  fetch: (request: Request, env?: Env, ctx?: { waitUntil?; passThroughOnException? }) => Promise<Response>;
}`}
      />

      <h2 id="daloyjs-core-vercel">
        <code>@daloyjs/core/vercel</code>
      </h2>
      <CodeBlock
        code={`type WebHandler = (req: Request) => Promise<Response>;
interface FetchHandler { fetch: WebHandler }
type RouteHandlers = Record<"GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"OPTIONS"|"HEAD", WebHandler>;

toWebHandler   (app: App): WebHandler;        // bare function (middleware, deprecated Edge runtime)
toFetchHandler (app: App): FetchHandler;      // default export for Node Functions
toRouteHandlers(app: App): RouteHandlers;     // Next.js App Router route.ts`}
      />

      <h2 id="daloyjs-core-fastly">
        <code>@daloyjs/core/fastly</code>
      </h2>
      <CodeBlock
        code={`toFastlyHandler(app: App): (req: Request) => Promise<Response>;
installFastlyListener(app: App): void;   // wires addEventListener("fetch", ...)`}
      />

      <h2 id="daloyjs-core-lambda">
        <code>@daloyjs/core/lambda</code>
      </h2>
      <CodeBlock
        code={`toLambdaHandler(app: App): LambdaHandler;
toLambdaStreamHandler(app: App): LambdaStreamHandler;

type LambdaHandler  = (event: LambdaEvent) => Promise<LambdaResponse>;
type LambdaStreamHandler = (event: LambdaEvent, responseStream: LambdaResponseStream, context?: unknown) => Promise<void>;
type LambdaEvent    = LambdaEventV1   | LambdaEventV2;     // API Gateway REST + HTTP/Function URLs
type LambdaResponse = LambdaResponseV1 | LambdaResponseV2;`}
      />

      <h2 id="test-only-internal-helpers">Test-only / internal helpers</h2>
      <p>
        These are exported for internal tests and tooling. They are public-typed
        but underscore-prefixed; they may change without a semver bump. Most
        application code will never need them.
      </p>
      <CodeBlock
        code={`_resetCrashHandlersForTests();
_resetInsecureDefaultsLogForTests();
_resetCompressionRuntimeProbeForTests();
_resetSharedRateLimitStoresForTests();`}
      />
    </>
  );
}
