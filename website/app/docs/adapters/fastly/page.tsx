import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
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
        Fastly Compute (JavaScript) still uses the <code>fetch</code> event
        listener model rather than the modules-style default export you see on
        Cloudflare Workers. The DaloyJS adapter wraps that registration so you
        only call one function.
      </p>

      <FlowDiagram
        title="Fastly Compute request path"
        steps={[
          {
            eyebrow: "platform",
            label: "fetch event",
            detail: "addEventListener('fetch', ...)",
          },
          {
            eyebrow: "adapter",
            label: "installFastlyListener(app)",
            detail: "event.respondWith(app.fetch(...))",
            tone: "muted",
          },
          {
            eyebrow: "core",
            label: "app.fetch(Request)",
            detail: "routing · hooks · handler",
            tone: "accent",
          },
          { eyebrow: "platform", label: "Response", tone: "success" },
        ]}
        caption="Fastly Compute still uses the fetch-event listener model. installFastlyListener registers it for you and forwards event.request into app.fetch. Outbound fetch() calls must be declared as backends in fastly.toml."
      />

      <h2 id="when-to-choose-fastly-compute">When to choose Fastly Compute</h2>
      <ul>
        <li>
          You already use Fastly&apos;s edge network and want REST API logic on
          the same plane.
        </li>
        <li>
          You want WebAssembly-compiled JS (<code>js-compute-runtime</code>) for
          tight cold starts.
        </li>
        <li>
          You&apos;re comfortable without <code>node:*</code> modules.
        </li>
      </ul>

      <h2 id="install">Install</h2>
      <CodeBlock
        language="bash"
        code={`pnpm add @daloyjs/core @fastly/js-compute
pnpm add -D @fastly/cli`}
      />

      <h2 id="entrypoint">Entrypoint</h2>
      <CodeBlock
        language="ts"
        code={`// src/index.ts
/// <reference types="@fastly/js-compute" />
import { installFastlyListener } from "@daloyjs/core/fastly";
import { app } from "./server.js";

installFastlyListener(app);`}
      />
      <p>Under the hood that&apos;s equivalent to:</p>
      <CodeBlock
        language="ts"
        code={`addEventListener("fetch", (event) =>
  event.respondWith(app.fetch(event.request))
);`}
      />

      <h2 id="fastly-toml">fastly.toml</h2>
      <p>
        Fastly Compute requires <code>manifest_version = 3</code>
        {". "}The <code>[scripts]</code> <code>build</code> command has to{" "}
        <strong>bundle TypeScript to a single JS file first</strong>
        {", "}then run <code>js-compute-runtime</code> against that bundle, the
        runtime only accepts JavaScript input.
      </p>
      <CodeBlock
        language="toml"
        code={`manifest_version = 3
name = "my-api"
language = "javascript"
description = "DaloyJS on Fastly Compute"

[scripts]
# Bundle src/index.ts -> bin/index.js -> bin/main.wasm
build = "esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=bin/index.js && js-compute-runtime bin/index.js bin/main.wasm"

# Declare every outbound HTTP service your REST API calls as a backend.
# Fastly Compute blocks arbitrary fetch() calls without a declared backend.
[local_server]
  [local_server.backends.auth-service]
    url = "https://auth.internal.example.com"`}
      />
      <p>
        Declared backends, KV stores, config stores, and secrets live under the
        same <code>[local_server.*]</code> /<code>[setup.*]</code> tables, see
        the{" "}
        <a
          href="https://www.fastly.com/documentation/reference/compute/fastly-toml/"
          target="_blank"
          rel="noreferrer"
        >
          fastly.toml reference
        </a>{" "}
        for the full schema.
      </p>

      <h2 id="deploy">Deploy</h2>
      <CodeBlock
        language="bash"
        code={`pnpm fastly compute serve     # local dev
pnpm fastly compute publish    # deploy`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          No <code>node:*</code> modules. Avoid the Node session store, the
          Redis rate-limit store, and multipart helpers that depend on{" "}
          <code>node:stream</code>
          {": "}use the fetch-based alternatives.
        </li>
        <li>
          Every outbound HTTP call your REST API makes (to a database API, auth
          service, or third-party endpoint) must be declared as a{" "}
          <strong>backend</strong> in <code>fastly.toml</code>
          {". "}Arbitrary <code>fetch(&quot;https://...&quot;)</code> calls fail
          at runtime without one.
        </li>
        <li>
          KV stores, config stores, and secrets are also declared in{" "}
          <code>fastly.toml</code> under <code>[setup]</code>.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/cloudflare-workers">
            Cloudflare Workers
          </Link>
          {", "}similar constraints, modules format.
        </li>
      </ul>
    </>
  );
}
