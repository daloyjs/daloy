import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Fastly Compute adapter",
  description:
    "Deploy DaloyJS to Fastly Compute (JavaScript) using @fastly/js-compute and the fetch-event listener model.",
  path: "/docs/adapters/fastly",
  keywords: [
    "DaloyJS Fastly Compute",
    "@fastly/js-compute",
    "fastly.toml",
    "installFastlyListener",
    "fetch event listener",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Fastly Compute</h1>
      <p>
        Fastly Compute (JavaScript) still uses the <code>fetch</code> event listener model rather
        than the modules-style default export you see on Cloudflare Workers. The DaloyJS adapter
        wraps that registration so you only call one function.
      </p>

      <h2>When to choose Fastly Compute</h2>
      <ul>
        <li>You already use Fastly for CDN and edge caching and want compute on the same plane.</li>
        <li>You want WebAssembly-compiled JS (<code>js-compute-runtime</code>) for tight cold starts.</li>
        <li>You&apos;re comfortable without <code>node:*</code> modules.</li>
      </ul>

      <h2>Install</h2>
      <CodeBlock
        language="bash"
        code={`pnpm add @daloyjs/core @fastly/js-compute
pnpm add -D @fastly/cli`}
      />

      <h2>Entrypoint</h2>
      <CodeBlock
        language="ts"
        code={`// src/index.ts
/// <reference types="@fastly/js-compute" />
import { installFastlyListener } from "@daloyjs/core/fastly";
import { app } from "./server.js";

installFastlyListener(app);`}
      />
      <p>
        Under the hood that&apos;s equivalent to:
      </p>
      <CodeBlock
        language="ts"
        code={`addEventListener("fetch", (event) =>
  event.respondWith(app.fetch(event.request))
);`}
      />

      <h2>fastly.toml</h2>
      <p>
        Fastly Compute requires <code>manifest_version = 3</code> and a <code>[scripts]</code>{" "}
        build command.
      </p>
      <CodeBlock
        language="toml"
        code={`manifest_version = 3
name = "my-api"
language = "javascript"
description = "DaloyJS on Fastly Compute"

[scripts]
build = "js-compute-runtime src/index.js bin/main.wasm"

[setup]
  [setup.backends.origin]
    url = "https://origin.example.com"
    description = "Upstream origin"`}
      />

      <h2>Deploy</h2>
      <CodeBlock
        language="bash"
        code={`pnpm fastly compute serve     # local dev
pnpm fastly compute publish    # deploy`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          No <code>node:*</code> modules. Avoid the Node session store, the Redis rate-limit store,
          and multipart helpers that depend on <code>node:stream</code> &mdash; use the fetch-based
          alternatives.
        </li>
        <li>
          Outbound HTTP must go through a declared <strong>backend</strong> in{" "}
          <code>fastly.toml</code>; arbitrary <code>fetch(&quot;https://...&quot;)</code> calls fail
          without one.
        </li>
        <li>
          KV stores, config stores, and secrets are also declared in <code>fastly.toml</code> under{" "}
          <code>[setup]</code>.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/cloudflare-workers">Cloudflare Workers</Link> &mdash; similar
          constraints, modules format.
        </li>
      </ul>
    </>
  );
}
