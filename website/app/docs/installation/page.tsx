import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Installation",
  description:
    "Install DaloyJS with pnpm, npm, yarn, or bun. Set up the framework on Node.js, Bun, Deno, Cloudflare Workers, or Vercel Edge in minutes.",
  path: "/docs/installation",
  keywords: ["install DaloyJS", "pnpm add daloyjs", "DaloyJS setup", "TypeScript framework install"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Installation</h1>
      <p>
        DaloyJS targets <strong>Node.js ≥ 20.10</strong> and is distributed on the public npm
        registry as <code>@daloyjs/core</code>. The package has <strong>no peer dependencies</strong>,
        so <code>npm</code>, <code>yarn</code>, <code>pnpm</code>, and <code>bun</code> can all install it
        directly. We <em>recommend</em> {" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm</a> together with the
        hardened <code>.npmrc</code> defaults below for supply-chain reasons, but it is not required.
        The <code>engines.pnpm</code> entry in <code>package.json</code> is advisory metadata, while{" "}
        <code>engines.node</code> communicates the supported runtime and may warn or fail depending on
        your package manager and engine-strict settings.
      </p>

      <h2>Fastest path: scaffold a project</h2>
      <p>
        Use the official generator — it sets up a hardened <code>.npmrc</code>, strict TypeScript,
        and a working route in one command.
      </p>
      <p>
        Package links: {" "}
        <a href="https://www.npmjs.com/package/create-daloy" target="_blank" rel="noreferrer">
          create-daloy on npm
        </a>{" "}
        and{" "}
        <a href="https://www.npmjs.com/package/@daloyjs/core" target="_blank" rel="noreferrer">
          @daloyjs/core on npm
        </a>
        .
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api
npm  create daloy@latest my-api
yarn create daloy           my-api
bun  create daloy           my-api`}
      />
      <p>
        See <Link href="/docs/scaffolder">Scaffold a project</Link> for templates and flags.
      </p>

      <h2>Or install into an existing project</h2>

      <h3>Prerequisites</h3>
      <ul>
        <li><strong>Node.js</strong> 20.10 or newer (LTS recommended).</li>
        <li>
          A package manager. Any of these works — pnpm 9.x is recommended for supply-chain hardening,
          but <code>npm</code>, <code>yarn</code>, and <code>bun</code> install <code>@daloyjs/core</code>{" "}
          cleanly because the package has no peer dependencies.
        </li>
      </ul>
      <p>To enable pnpm via <a href="https://nodejs.org/api/corepack.html" target="_blank" rel="noreferrer">Corepack</a>:</p>
      <CodeBlock language="bash" code={`corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version`} />

      <h3>Install DaloyJS</h3>
      <CodeBlock language="bash" code={`pnpm add @daloyjs/core zod
npm  install @daloyjs/core zod
yarn add     @daloyjs/core zod
bun  add     @daloyjs/core zod
# optional — only if you want to generate a typed SDK
pnpm add -D @hey-api/openapi-ts`} />
      <p>
        The framework package published to npm is{" "}
        <a href="https://www.npmjs.com/package/@daloyjs/core" target="_blank" rel="noreferrer">
          @daloyjs/core
        </a>
        .
      </p>

      <h2>Hardened <code>.npmrc</code></h2>
      <p>
        Drop this <code>.npmrc</code> in your project root to make pnpm reject unsafe installs by default:
      </p>
      <CodeBlock language="ini" code={`auto-install-peers=true
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
# Optional, pnpm 10+:
# minimum-release-age=1440   # wait 24h before installing fresh releases
# ignore-scripts=true        # whitelist install scripts via approve-builds`} />

      <p>
        Read the rationale in <Link href="/docs/security">Security</Link> and the{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm motivation guide</a>.
      </p>

      <h2>Verify</h2>
      <p>
        Run this from the project root after installing — it works the same under pnpm,
        npm, yarn, or bun because it shells straight to <code>node</code>:
      </p>
      <CodeBlock language="bash" code={`node -e "import('@daloyjs/core').then(m => console.log('DaloyJS ok →', Object.keys(m).slice(0, 6)))"`} />

      <h2>Next</h2>
      <p>
        Continue with <Link href="/docs/getting-started">Getting started</Link> to write your first route.
      </p>
    </>
  );
}
