import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { LayerStack } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Bun adapter",
  description:
    "Run a DaloyJS REST API on Bun 1.2+ with native Bun.serve, TLS, Unix sockets, and hot reload.",
  path: "/docs/adapters/bun",
  keywords: [
    "DaloyJS Bun adapter",
    "Bun.serve",
    "Bun TLS",
    "Bun unix socket",
    "Bun idleTimeout",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Bun</h1>
      <p>
        The Bun adapter wraps the native <code>Bun.serve</code> API for REST API
        deployments. You get fast startup, a smaller memory footprint, and
        first-class TLS and Unix-socket support without extra middleware.
      </p>

      <LayerStack
        title="Bun adapter stack"
        layers={[
          {
            title: "Your DaloyJS App",
            detail: "routes · hooks · handlers",
            tone: "accent",
          },
          {
            title: "Bun adapter",
            detail: "serve(app) wraps Bun.serve",
            items: ["idleTimeout", "tls", "unix"],
          },
          {
            title: "Bun runtime",
            detail: "native Bun.serve, fast startup",
            tone: "muted",
          },
        ]}
        caption="serve() hands your app to the native Bun.serve so routing stays owned by DaloyJS. Bun's built-in routes option is intentionally unused to keep the same REST API portable across runtimes."
      />

      <h2 id="when-to-choose-bun">When to choose Bun</h2>
      <ul>
        <li>
          You want startup measured in milliseconds and lower per-request
          overhead than Node.
        </li>
        <li>You ship a single self-contained binary or a small container.</li>
        <li>
          You&apos;re fine with Bun 1.2+ (matches the adapter&apos;s
          expectations).
        </li>
      </ul>

      <h2 id="scaffold">Scaffold</h2>
      <p>
        The <code>bun-basic</code> template ships a Bun-native server with{" "}
        <code>bun test</code> and Hey&nbsp;API codegen.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template bun-basic
cd my-api
pnpm dev    # daloy dev --runtime bun (hot-reload)`}
      />

      <h2 id="install">Install</h2>
      <CodeBlock language="bash" code={`bun add @daloyjs/core`} />

      <h2 id="minimal-server">Minimal server</h2>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/bun";
import { app } from "./app.ts";

const handle = serve(app, {
  port: 3000,
  hostname: "0.0.0.0",
  idleTimeout: 30,          // seconds; Bun default is 10
  development: false,       // disables Bun's dev error pages in prod
  // unix: "/tmp/daloy.sock",
  // tls: { cert, key },    // HTTPS
});

console.log("listening on " + handle.url);`}
      />

      <h2 id="hot-reload-in-dev">Hot reload in dev</h2>
      <CodeBlock language="bash" code={`bun --hot src/server.ts`} />

      <h2 id="dockerfile">Dockerfile</h2>
      <CodeBlock
        language="docker"
        code={`FROM oven/bun:1.2-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build --target=bun src/server.ts --outdir dist

FROM oven/bun:1.2-distroless
WORKDIR /app
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["dist/server.js"]`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          <code>idleTimeout</code> is in <strong>seconds</strong>, capped at
          255. Pass <code>0</code> to disable.
        </li>
        <li>
          Some npm packages with native bindings still need Node, test before
          committing to Bun in production.
        </li>
        <li>
          Bun&apos;s built-in <code>routes</code> option is not used by the
          adapter; routing is owned by DaloyJS so the same REST API stays
          portable across runtimes.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/node">Node.js adapter</Link>
        </li>
      </ul>
    </>
  );
}
