import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Scaffold a DaloyJS project",
  description:
    "Use create-daloy to scaffold a production-ready DaloyJS project with templates for Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge — preconfigured with TypeScript, Zod, and OpenAPI.",
  path: "/docs/scaffolder",
  keywords: ["create-daloy", "scaffold DaloyJS", "DaloyJS template", "Cloudflare Worker template", "Vercel Edge template"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Scaffold a project</h1>
      <p>
        <code>create-daloy</code> is the official project generator. It scaffolds a working DaloyJS app
        in seconds — no copy-pasting from the docs.
      </p>
      <p>
        Package link:{" "}
        <a href="https://www.npmjs.com/package/create-daloy" target="_blank" rel="noreferrer">
          create-daloy on npm
        </a>
        . The generated apps install the framework from{" "}
        <a href="https://www.npmjs.com/package/@daloyjs/core" target="_blank" rel="noreferrer">
          @daloyjs/core on npm
        </a>
        .
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        language="bash"
        code={`# pick the package manager you actually use
pnpm create daloy@latest my-api
npm  create daloy@latest my-api
yarn create daloy           my-api
bun  create daloy           my-api`}
      />

      <p>
        The CLI is interactive when arguments are missing. It will ask for a project name, a template,
        a package manager, whether to install dependencies, and whether to initialize a git repository.
      </p>

      <h2>Non-interactive usage</h2>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api \\
  --template node-basic \\
  --package-manager pnpm \\
  --install \\
  --git`}
      />

      <h3>Flags</h3>
      <ul>
        <li>
          <code>--template &lt;name&gt;</code> — <code>node-basic</code> (default),{" "}
          <code>vercel-edge</code>, <code>cloudflare-worker</code>, <code>bun-basic</code>, or{" "}
          <code>deno-basic</code>.
        </li>
        <li>
          <code>--package-manager &lt;pm&gt;</code> — <code>pnpm</code> (default), <code>npm</code>,{" "}
          <code>yarn</code>, or <code>bun</code>.
        </li>
        <li>
          <code>--list-templates</code> — print available templates with descriptions.
        </li>
        <li>
          <code>--install</code> / <code>--no-install</code> — install dependencies after scaffolding.
        </li>
        <li>
          <code>--git</code> / <code>--no-git</code> — initialize a git repository.
        </li>
        <li>
          <code>--minimal</code> — strip the bookstore demo and the{" "}
          <code>/docs</code> + <code>/openapi.json</code> Swagger UI routes so the
          scaffold only ships the framework bootstrap and a health route. Useful
          when you want to start from the smallest possible app.
        </li>
        <li>
          <code>--force</code> — overwrite an existing non-empty directory.
        </li>
        <li>
          <code>--yes</code> — accept all defaults; never prompt.
        </li>
      </ul>

      <h2>Templates</h2>
      <p>
        Run <code>create-daloy --list-templates</code> to inspect the available starters without
        creating a project.
      </p>

      <h3><code>node-basic</code></h3>
      <p>
        A production-ready Node.js HTTP server using <code>@daloyjs/core</code> with{" "}
        <code>secureHeaders</code>, <code>requestId</code>, <code>rateLimit</code>, a hardened{" "}
        <code>.npmrc</code>, a sample <code>GET /healthz</code> route, a contract-first{" "}
        <code>GET /books/:id</code> route with Zod validation, and Hey API codegen wired to{" "}
        <code>pnpm gen</code>.
      </p>
      <p>
        Like FastAPI, every scaffolded project also exposes API documentation out of the box:{" "}
        <code>/docs</code> serves Swagger UI and <code>/openapi.json</code> serves the live
        OpenAPI 3.1 spec generated from your route definitions. The dev server logs both URLs at
        startup.
      </p>

      <h3><code>cloudflare-worker</code></h3>
      <p>
        A minimal Cloudflare Worker using <code>@daloyjs/core/cloudflare</code> with{" "}
        <code>wrangler.toml</code> ready to deploy, <code>secureHeaders</code> + <code>requestId</code>
        enabled by default, smaller edge-friendly body and timeout limits, and a Zod-validated route
        exposed as <code>fetch</code>.
      </p>

      <h3><code>vercel-edge</code></h3>
      <p>
        A Vercel Edge API using <code>@daloyjs/core/vercel</code> with a catch-all{" "}
        <code>api/[...path].ts</code> route, <code>vercel dev</code> / <code>vercel deploy</code>{" "}
        scripts, <code>secureHeaders</code> + <code>requestId</code> enabled by default, smaller
        edge-friendly body and timeout limits, and the same health and bookstore examples as the
        Node starter.
      </p>
      <p>
        The Vercel template also ships <code>/docs</code> (Swagger UI) and <code>/openapi.json</code>
        wired to the same app, so the deployed Edge URL serves API documentation automatically.
      </p>

      <h3><code>bun-basic</code></h3>
      <p>
        A <a href="https://bun.sh" target="_blank" rel="noreferrer">Bun</a> runtime starter using
        <code>@daloyjs/core/bun</code>. Ships <code>bun --hot</code> for instant reloads,
        <code>bun test</code> for the test runner, the same starter security middleware as the Node
        template (<code>secureHeaders</code> / <code>requestId</code> / <code>rateLimit</code>), the
        bookstore demo route, and Hey API codegen wired through <code>bun run gen:openapi</code> +
        <code>bun run gen:client</code>.
      </p>

      <h3><code>deno-basic</code></h3>
      <p>
        A <a href="https://deno.com" target="_blank" rel="noreferrer">Deno</a> runtime starter using
        <code>@daloyjs/core/deno</code>. Ships a <code>deno.json</code> with{" "}
        <code>deno task dev</code>, <code>deno task test</code>, and{" "}
        <code>deno task gen:openapi</code> tasks, loads <code>@daloyjs/core</code> and Zod via{" "}
        <code>npm:</code> import-map specifiers, and runs with the minimum permissions Deno requires
        (<code>--allow-net --allow-env --allow-read</code>). The CLI skips Node-style installs for
        this template — there is no <code>package.json</code> to patch.
      </p>

      <h2>Minimal scaffolds</h2>
      <p>
        Pass <code>--minimal</code> to drop the bookstore demo route and the built-in{" "}
        <code>/docs</code> + <code>/openapi.json</code> Swagger UI routes from any template that
        supports them. The scaffolded app is left with the framework bootstrap and a single{" "}
        <code>/healthz</code> route, which is the smallest realistic starting point for teams
        that already know exactly what they want to build:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template node-basic --minimal --yes`}
      />
      <p>
        Sentinel comments (<code>{"// daloy-minimal:strip-start <tag>"}</code> /
        <code>{"// daloy-minimal:strip-end <tag>"}</code>) survive a default scaffold so you can
        re-run the generator with <code>--minimal</code> later, or delete the marked blocks by hand.
      </p>

      <h2>Which template should I choose?</h2>
      <ul>
        <li>
          Choose <code>node-basic</code> for a traditional REST API on Node, Docker, Fly.io,
          Railway, Render, or any VM/container host.
        </li>
        <li>
          Choose <code>vercel-edge</code> when Vercel is your deployment target and you want an
          Edge API route from the first commit.
        </li>
        <li>
          Choose <code>cloudflare-worker</code> only when your deployment target is Cloudflare Workers.
          It exists because DaloyJS is runtime-portable, not because Cloudflare is required.
        </li>
        <li>
          Choose <code>bun-basic</code> when your team already runs on{" "}
          <a href="https://bun.sh" target="_blank" rel="noreferrer">Bun</a> and wants{" "}
          <code>bun --hot</code> + <code>bun test</code> in the box.
        </li>
        <li>
          Choose <code>deno-basic</code> when you want a runtime-native{" "}
          <a href="https://deno.com" target="_blank" rel="noreferrer">Deno</a> project with{" "}
          <code>deno task</code> scripts, an import map, and Deno&apos;s permission flags.
        </li>
      </ul>

      <h2>Why a generator?</h2>
      <p>
        DaloyJS is a backend framework, so the first ten minutes matter. The scaffolder gives every
        project the same guardrail-first posture, the same TypeScript baseline, and the same scripts
        so an AI coding agent or a new teammate can navigate it without a tour. Node, Bun, and Deno
        starters include <code>secureHeaders</code>, <code>requestId</code>, and <code>rateLimit</code>;
        the edge starters include <code>secureHeaders</code> and <code>requestId</code> plus tighter
        body and timeout limits.
      </p>
      <p>
        The CLI itself ships with{" "}
        <strong>zero runtime dependencies</strong> — only Node built-ins — so the supply-chain story
        stays clean. Templates are copied verbatim from the package&apos;s <code>templates/</code>{" "}
        directory and never run scripts during scaffolding. When you choose <code>pnpm</code>, the
        generated app keeps the hardened <code>.npmrc</code>; when you choose another package manager,
        the CLI removes pnpm-specific config so installs stay warning-free.
      </p>

      <h2>Next</h2>
      <p>
        After scaffolding, jump straight to{" "}
        <Link href="/docs/getting-started">Getting started</Link> for the route walkthrough, or{" "}
        <Link href="/docs/security">Security</Link> for the guardrails and middleware you just inherited.
      </p>
    </>
  );
}
