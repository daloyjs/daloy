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
        DaloyJS targets <strong>Node.js ≥ 20.10</strong> and is distributed via{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm</a> for supply-chain
        hygiene. Bun and Deno can install via their package managers using the npm registry.
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
        <li><strong>pnpm</strong> 9.x or newer. Enable via <a href="https://nodejs.org/api/corepack.html" target="_blank" rel="noreferrer">Corepack</a>:</li>
      </ul>
      <CodeBlock language="bash" code={`corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version`} />

      <h3>Install DaloyJS</h3>
      <CodeBlock language="bash" code={`pnpm add @daloyjs/core
# optional — only if you want to generate a typed SDK
pnpm add -D @hey-api/openapi-ts
# pick your validator (any Standard Schema implementation works)
pnpm add zod`} />
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
      <CodeBlock language="bash" code={`pnpm exec node -e "import('@daloyjs/core').then(m => console.log('DaloyJS ok →', Object.keys(m).slice(0, 6)))"`} />

      <h2>Next</h2>
      <p>
        Continue with <Link href="/docs/getting-started">Getting started</Link> to write your first route.
      </p>
    </>
  );
}
