import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Scaffold a DaloyJS project",
  description:
    "Use create-daloy to scaffold a production-ready DaloyJS project with templates for Node.js, Bun, Deno, and Cloudflare Workers, plus optional hardened GitHub CI.",
  path: "/docs/scaffolder",
  keywords: [
    "create-daloy",
    "scaffold DaloyJS",
    "DaloyJS template",
    "Cloudflare Worker template",
    "Vercel template",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Scaffold a project</h1>
      <p>
        <code>create-daloy</code> is the official project generator. It
        scaffolds a working DaloyJS app in seconds, no copy-pasting from the
        docs.
      </p>
      <p>
        Package link:{" "}
        <a
          href="https://www.npmjs.com/package/create-daloy"
          target="_blank"
          rel="noreferrer"
        >
          create-daloy on npm
        </a>
        {". "}The generated apps install the framework from{" "}
        <a
          href="https://www.npmjs.com/package/@daloyjs/core"
          target="_blank"
          rel="noreferrer"
        >
          @daloyjs/core on npm
        </a>
        {"."}
      </p>

      <BranchDiagram
        title="One generator, five templates"
        source={{
          eyebrow: "generator",
          label: "create-daloy",
          detail: "pnpm create daloy@latest my-api",
        }}
        branches={[
          {
            eyebrow: "default",
            label: "node-basic",
            detail: "@daloyjs/core/node",
          },
          {
            eyebrow: "serverless",
            label: "vercel",
            detail: "@daloyjs/core/vercel",
          },
          {
            eyebrow: "edge",
            label: "cloudflare-worker",
            detail: "@daloyjs/core/cloudflare",
          },
          {
            eyebrow: "runtime",
            label: "bun-basic",
            detail: "@daloyjs/core/bun",
          },
          {
            eyebrow: "runtime",
            label: "deno-basic",
            detail: "@daloyjs/core/deno",
          },
        ]}
        caption="Pick a target with --template. Every starter ships the same guardrail-first posture and scripts, only the runtime adapter and config differ."
      />

      <h2 id="quick-start">Quick start</h2>
      <CodeBlock
        language="bash"
        code={`# pick the package manager you actually use
pnpm create daloy@latest my-api
npm  create daloy@latest my-api
yarn create daloy           my-api
bun  create daloy           my-api`}
      />

      <p>
        The CLI is interactive when arguments are missing. It will ask for a
        project name, a template, a package manager, whether to install
        dependencies, whether to initialize a git repository, and whether to add
        the GitHub security bundle. The dependency-install prompt defaults to{" "}
        <code>no</code> for pnpm projects so you can review the generated{" "}
        <code>.npmrc</code> and <code>pnpm-workspace.yaml</code> guardrails
        before the first install; other package managers default to{" "}
        <code>yes</code>.
      </p>

      <FlowDiagram
        numbered
        title="The interactive prompts"
        steps={[
          { label: "Project name", detail: "my-api" },
          { label: "Template", detail: "node-basic, vercel, ..." },
          { label: "Package manager", detail: "pnpm, npm, yarn, bun" },
          { label: "Install deps?", detail: "--install / --no-install" },
          { label: "Init git?", detail: "--git / --no-git" },
          {
            label: "GitHub security bundle?",
            detail: "--with-ci",
            tone: "success",
          },
        ]}
        caption="When you omit flags the CLI prompts for each choice in order. Pass --yes to accept every default and skip the prompts entirely. Defaults are pnpm, node-basic, no pnpm install, the GitHub security bundle enabled, and the deploy starter enabled with it."
      />

      <h2 id="non-interactive-usage">Non-interactive usage</h2>
      <CodeBlock
        language="bash"
        code="pnpm create daloy@latest my-api --template node-basic --package-manager pnpm --with-ci --code-owner @acme/security --install --git"
      />

      <h3 id="flags">Flags</h3>
      <ul>
        <li>
          <code>--template &lt;name&gt;</code>
          {": "}<code>node-basic</code> (default), <code>vercel</code>
          {", "}<code>cloudflare-worker</code>
          {", "}
          <code>bun-basic</code>
          {", "}or <code>deno-basic</code>.
        </li>
        <li>
          <code>--package-manager &lt;pm&gt;</code>
          {": "}<code>pnpm</code> (default), <code>npm</code>
          {", "}<code>yarn</code>
          {", "}or <code>bun</code>.
        </li>
        <li>
          <code>--list-templates</code>
          {": "}print available templates with descriptions.
        </li>
        <li>
          <code>--install</code> / <code>--no-install</code>
          {": "}install dependencies after scaffolding. Defaults to{" "}
          <code>no</code> for pnpm projects and <code>yes</code> for npm, Yarn,
          and Bun projects.
        </li>
        <li>
          <code>--git</code> / <code>--no-git</code>
          {": "}initialize a git repository.
        </li>
        <li>
          <code>--minimal</code>
          {": "}strip the bookstore demo and the auto-mounted{" "}
          <code>/docs</code> + <code>/openapi.json</code> API docs routes so the
          scaffold only ships the framework bootstrap and a health route. Useful
          when you want to start from the smallest possible app.
        </li>
        <li>
          <code>--with-ci</code> / <code>--no-ci</code>
          {": "}add hardened GitHub Actions, Dependabot, CODEOWNERS,{" "}
          <code>SECURITY.md</code>
          {", "}and lockfile-source verification. Defaults to <code>yes</code>.
        </li>
        <li>
          <code>--with-deploy</code> / <code>--no-deploy</code>
          {": "}add or skip the manual-only starter{" "}
          <code>.github/workflows/deploy.yml</code>
          {". "}
          Defaults to the same value as <code>--with-ci</code>.
        </li>
        <li>
          <code>--code-owner &lt;owner&gt;</code>
          {": "}replace the CODEOWNERS placeholder when <code>--with-ci</code>{" "}
          is used, for example <code>@acme/security</code>.
        </li>
        <li>
          <code>--force</code>
          {": "}overwrite an existing non-empty directory.
        </li>
        <li>
          <code>--yes</code>
          {": "}accept all defaults; never prompt.
        </li>
      </ul>

      <h3 id="missing-tool-hints">Missing-tool hints</h3>
      <p>
        Before printing the completion summary, the CLI checks whether the
        runtime and package manager your selections actually need are on your{" "}
        <code>PATH</code>
        {". "}If something is missing, it prints an official install link next
        to the next steps instead of leaving you to hit a{" "}
        <code>command not found</code> on your first command. For example,
        scaffolding the <code>bun-basic</code> template on a machine without Bun
        surfaces a{" "}
        <a href="https://bun.sh" target="_blank" rel="noreferrer">
          https://bun.sh
        </a>{" "}
        link, and choosing <code>pnpm</code> without pnpm installed surfaces{" "}
        <a href="https://pnpm.io/installation" target="_blank" rel="noreferrer">
          https://pnpm.io/installation
        </a>
        {". "}Node-flavored templates (<code>node-basic</code>
        {", "}<code>vercel</code>
        {", "}
        <code>cloudflare-worker</code>) point at{" "}
        <a href="https://nodejs.org" target="_blank" rel="noreferrer">
          https://nodejs.org
        </a>{" "}
        when Node.js is absent. The probe only reads <code>PATH</code> (it never
        executes the binary), and if you asked to install dependencies but the
        chosen package manager is missing, the CLI skips the doomed install and
        shows the link instead. When every required tool is present, no hint is
        printed.
      </p>
      <p>
        The CLI also checks <strong>versions</strong>
        {", "}not just presence. <code>npm create daloy</code> and{" "}
        <code>npx</code> will run the scaffolder on an old Node.js because{" "}
        <code>engines</code> are only advisory there, so the CLI verifies it
        itself: if you are on a Node.js older than <strong>24</strong>
        {", "}it stops before scaffolding with a clear message, the{" "}
        <a href="https://nodejs.org" target="_blank" rel="noreferrer">
          nodejs.org
        </a>{" "}
        link, and a nudge toward a version manager (nvm, fnm, Volta) rather than
        generating a project your runtime cannot run. And when you pick{" "}
        <code>npm</code>
        {", "}it detects an npm older than <strong>12</strong> up front, tells
        you to run <code>npm install -g npm@latest</code>
        {", "}and skips the automatic install so you get a readable explanation
        instead of npm&apos;s raw <code>EBADENGINE</code> error partway through.
      </p>

      <h2 id="templates">Templates</h2>
      <p>
        Run <code>create-daloy --list-templates</code> to inspect the available
        starters without creating a project.
      </p>

      <h3 id="node-basic">
        <code>node-basic</code>
      </h3>
      <p>
        A production-ready Node.js HTTP server using <code>@daloyjs/core</code>{" "}
        with <code>secureHeaders</code>
        {", "}<code>requestId</code>
        {", "}
        <code>rateLimit</code>
        {", "}a hardened <code>.npmrc</code>
        {", "}a sample <code>GET /healthz</code> route, a contract-first{" "}
        <code>GET /books/:id</code> route with Zod validation, and Hey API
        codegen wired to <code>pnpm gen</code>.
      </p>
      <p>
        Like FastAPI, every scaffolded project also exposes API documentation
        out of the box: <code>/docs</code> serves a Scalar API reference UI and{" "}
        <code>/openapi.json</code> serves the live OpenAPI 3.1 spec generated
        from your route definitions. The dev server logs both URLs at startup.
        Pass <code>{`docs: { ui: "swagger" }`}</code> on the <code>App</code>{" "}
        constructor to switch to Swagger UI instead.
      </p>

      <h3 id="cloudflare-worker">
        <code>cloudflare-worker</code>
      </h3>
      <p>
        A minimal Cloudflare Worker using <code>@daloyjs/core/cloudflare</code>{" "}
        with <code>wrangler.toml</code> ready to deploy,{" "}
        <code>secureHeaders</code> + <code>requestId</code>
        enabled by default, smaller edge-friendly body and timeout limits, and a
        Zod-validated route exposed as <code>fetch</code>.
      </p>

      <h3 id="vercel">
        <code>vercel</code>
      </h3>
      <p>
        A Vercel API on the Node.js runtime (Vercel&apos;s recommended runtime
        for standalone functions) using <code>@daloyjs/core/vercel</code> with a
        single <code>api/index.ts</code> function exporting{" "}
        <code>toFetchHandler(app)</code> (plus a <code>vercel.json</code>{" "}
        rewrite so DaloyJS routes at the site root), <code>vercel dev</code> /{" "}
        <code>vercel deploy</code> scripts, <code>secureHeaders</code> +{" "}
        <code>requestId</code> enabled by default, smaller serverless-friendly
        body and timeout limits, and the same health and bookstore examples as
        the Node starter.
      </p>
      <p>
        The Vercel template also ships <code>/docs</code> (Scalar API reference)
        and <code>/openapi.json</code>
        wired to the same app, so the deployed Vercel URL serves API
        documentation automatically.
      </p>

      <h3 id="bun-basic">
        <code>bun-basic</code>
      </h3>
      <p>
        A{" "}
        <a href="https://bun.sh" target="_blank" rel="noreferrer">
          Bun
        </a>{" "}
        runtime starter using
        <code>@daloyjs/core/bun</code>
        {". "}Ships <code>bun --hot</code> for instant reloads,
        <code>bun test</code> for the test runner, the same starter security
        middleware as the Node template (<code>secureHeaders</code> /{" "}
        <code>requestId</code> / <code>rateLimit</code>), the bookstore demo
        route, and Hey API codegen wired through{" "}
        <code>bun run gen:openapi</code> +<code>bun run gen:client</code>.
      </p>

      <h3 id="deno-basic">
        <code>deno-basic</code>
      </h3>
      <p>
        A{" "}
        <a href="https://deno.com" target="_blank" rel="noreferrer">
          Deno
        </a>{" "}
        runtime starter using
        <code>@daloyjs/core/deno</code>
        {". "}Ships a <code>deno.json</code> with <code>deno task dev</code>
        {", "}<code>deno task test</code>
        {", "}and <code>deno task gen:openapi</code> tasks, loads{" "}
        <code>@daloyjs/core</code> and Zod via <code>npm:</code> import-map
        specifiers, and runs with the minimum permissions Deno requires (
        <code>--allow-net --allow-env --allow-read</code>). The CLI skips
        Node-style installs for this template, there is no{" "}
        <code>package.json</code> to patch.
      </p>

      <h2 id="minimal-scaffolds">Minimal scaffolds</h2>
      <p>
        Pass <code>--minimal</code> to drop the bookstore demo route and the
        built-in <code>/docs</code> + <code>/openapi.json</code> API docs routes
        from any template that supports them. The scaffolded app is left with
        the framework bootstrap and a single <code>/healthz</code> route, which
        is the smallest realistic starting point for teams that already know
        exactly what they want to build:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template node-basic --minimal --yes`}
      />
      <p>
        Sentinel comments (<code>{"// daloy-minimal:strip-start <tag>"}</code> /
        <code>{"// daloy-minimal:strip-end <tag>"}</code>) survive a default
        scaffold so you can re-run the generator with <code>--minimal</code>{" "}
        later, or delete the marked blocks by hand.
      </p>

      <h2 id="hardened-ci-security-bundle">Hardened CI/security bundle</h2>
      <p>
        Pass <code>--with-ci</code> when the new project should start with
        GitHub-side supply-chain guardrails as well as runtime defaults.
        Node-style templates get CI, a manual-only deploy starter, CodeQL,
        OpenSSF Scorecard, zizmor, Dependabot, CODEOWNERS,{" "}
        <code>SECURITY.md</code>
        {", "}and a lockfile-source verification script. The Deno template gets
        the same governance and scanning files with a Deno-native CI workflow.
        No template gets an npm publish workflow, because{" "}
        <code>create-daloy</code> scaffolds REST API services rather than
        reusable libraries.
      </p>
      <CodeBlock
        language="bash"
        code="pnpm create daloy@latest my-api --template node-basic --package-manager pnpm --with-ci --code-owner @acme/security"
      />
      <p>
        The generated workflows use top-level <code>{"permissions: {}"}</code>
        {", "}
        pinned third-party actions, <code>harden-runner</code>
        {", "}
        <code>persist-credentials: false</code>
        {", "}disabled install scripts, and no package-manager cache. Replace
        the CODEOWNERS placeholder if you did not pass <code>--code-owner</code>
        {", "}then enable branch protection, required status checks, secret
        scanning, and push protection in GitHub settings. Use{" "}
        <code>--with-ci --no-deploy</code> when you want governance without
        deployment scaffolding, or <code>--with-deploy --no-ci</code> when you
        only want the deployment starter.
      </p>

      <h2 id="editor-mcp-integration">Editor MCP integration</h2>
      <p>
        Every scaffold ships a <code>.vscode/mcp.json</code> that wires VS Code
        (and other MCP-aware editors) to the DaloyJS documentation MCP server at{" "}
        <code>https://daloyjs.dev/mcp</code> over HTTP. With it, AI assistants
        in your editor can pull current DaloyJS docs while you work, with no
        manual setup. The file is authored as <code>_vscode/mcp.json</code> in
        the template and renamed to <code>.vscode/mcp.json</code> on copy so it
        survives npm packing.
      </p>
      <CodeBlock
        language="json"
        code={`{
  "servers": {
    "daloyjs-docs": {
      "type": "http",
      "url": "https://daloyjs.dev/mcp"
    }
  }
}`}
      />
      <p>
        Delete the file or remove the server entry if you do not want the
        integration. It is editor configuration only and the framework does not
        depend on it at runtime.
      </p>

      <h2 id="which-template-should-i-choose">
        Which template should I choose?
      </h2>
      <ul>
        <li>
          Choose <code>node-basic</code> for a traditional REST API on Node,
          Docker, Fly.io, Railway, Render, or any VM/container host.
        </li>
        <li>
          Choose <code>vercel</code> when Vercel is your deployment target and
          you want a catch-all Vercel Functions API route (Node.js runtime) from
          the first commit.
        </li>
        <li>
          Choose <code>cloudflare-worker</code> only when your deployment target
          is Cloudflare Workers. It exists because DaloyJS is runtime-portable,
          not because Cloudflare is required.
        </li>
        <li>
          Choose <code>bun-basic</code> when your team already runs on{" "}
          <a href="https://bun.sh" target="_blank" rel="noreferrer">
            Bun
          </a>{" "}
          and wants <code>bun --hot</code> + <code>bun test</code> in the box.
        </li>
        <li>
          Choose <code>deno-basic</code> when you want a runtime-native{" "}
          <a href="https://deno.com" target="_blank" rel="noreferrer">
            Deno
          </a>{" "}
          project with <code>deno task</code> scripts, an import map, and
          Deno&apos;s permission flags.
        </li>
      </ul>

      <h2 id="why-a-generator">Why a generator?</h2>
      <p>
        DaloyJS is a backend framework, so the first ten minutes matter. The
        scaffolder gives every project the same guardrail-first posture, the
        same TypeScript baseline, and the same scripts so an AI coding agent or
        a new teammate can navigate it without a tour. Node, Bun, and Deno
        starters include <code>secureHeaders</code>
        {", "}<code>requestId</code>
        {", "}and <code>rateLimit</code>; the edge starters include{" "}
        <code>secureHeaders</code> and <code>requestId</code> plus tighter body
        and timeout limits.
      </p>
      <p>
        The CLI itself ships with <strong>zero runtime dependencies</strong>
        {": "}
        only Node built-ins, so the supply-chain story stays clean. Templates
        are copied verbatim from the package&apos;s <code>templates/</code>{" "}
        directory and never run scripts during scaffolding. When you choose{" "}
        <code>pnpm</code>
        {", "}the generated app keeps the hardened <code>.npmrc</code> and{" "}
        <code>pnpm-workspace.yaml</code>
        {", "}and the CLI adds a <code>pnpm &gt;= 11</code> floor to{" "}
        <code>engines</code> (pnpm always enforces <code>engines.pnpm</code>) —
        older pnpm silently ignores <code>minimumReleaseAge</code>
        {", "}which would disable the 24h supply-chain cooldown; the CLI also
        warns up front if the installed pnpm is older. When you choose{" "}
        <code>npm</code>
        {", "}the CLI adds an <code>npm &gt;= 12</code> floor to{" "}
        <code>engines</code> and swaps in an npm-native <code>.npmrc</code> with{" "}
        <code>engine-strict=true</code> so that floor is a hard install-time
        failure rather than a warning; yarn and bun scaffolds drop the
        pnpm-specific config so installs stay warning-free. When you choose{" "}
        <code>--with-ci</code>
        {", "}it also adds the GitHub-side security files that a company repo
        normally has to assemble by hand.
      </p>

      <h2 id="next">Next</h2>
      <p>
        After scaffolding, jump straight to{" "}
        <Link href="/docs/getting-started">Getting started</Link> for the route
        walkthrough, or <Link href="/docs/security">Security</Link> for the
        guardrails and middleware you just inherited.
      </p>
    </>
  );
}
