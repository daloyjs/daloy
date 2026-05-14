import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

export const metadata = { title: "Scaffold a project" };

export default function Page() {
  return (
    <>
      <h1>Scaffold a project</h1>
      <p>
        <code>create-daloy</code> is the official project generator. It scaffolds a working DaloyJS app
        in seconds — no copy-pasting from the docs.
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
          <code>vercel-edge</code>, or <code>cloudflare-worker</code>.
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
        <code>wrangler.toml</code> ready to deploy and a Zod-validated route exposed as{" "}
        <code>fetch</code>.
      </p>

      <h3><code>vercel-edge</code></h3>
      <p>
        A Vercel Edge API using <code>@daloyjs/core/vercel</code> with a catch-all{" "}
        <code>api/[...path].ts</code> route, <code>vercel dev</code> / <code>vercel deploy</code>{" "}
        scripts, secure defaults, and the same health and bookstore examples as the Node starter.
      </p>
      <p>
        The Vercel template also ships <code>/docs</code> (Swagger UI) and <code>/openapi.json</code>
        wired to the same app, so the deployed Edge URL serves API documentation automatically.
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
      </ul>

      <h2>Why a generator?</h2>
      <p>
        DaloyJS is a backend framework, so the first ten minutes matter. The scaffolder gives every
        project the same secure defaults, the same TypeScript baseline, and the same scripts so an
        AI coding agent or a new teammate can navigate it without a tour.
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
        <Link href="/docs/security">Security</Link> for the defaults you just inherited.
      </p>
    </>
  );
}
