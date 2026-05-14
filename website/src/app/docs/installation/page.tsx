import { CodeBlock } from "@/components/code-block";
import Link from "next/link";

export const metadata = { title: "Installation" };

export default function Page() {
  return (
    <>
      <h1>Installation</h1>
      <p>
        DaloyJS targets <strong>Node.js ≥ 20.10</strong> and is distributed via{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">pnpm</a> for supply-chain
        hygiene. Bun and Deno can install via their package managers using the npm registry.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li><strong>Node.js</strong> 20.10 or newer (LTS recommended).</li>
        <li><strong>pnpm</strong> 9.x or newer. Enable via <a href="https://nodejs.org/api/corepack.html" target="_blank" rel="noreferrer">Corepack</a>:</li>
      </ul>
      <CodeBlock language="bash" code={`corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --version`} />

      <h2>Install DaloyJS</h2>
      <CodeBlock language="bash" code={`pnpm add daloy
# optional — only if you want to generate a typed SDK
pnpm add -D @hey-api/openapi-ts
# pick your validator (any Standard Schema implementation works)
pnpm add zod`} />

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
      <CodeBlock language="bash" code={`pnpm exec node -e "import('daloy').then(m => console.log('DaloyJS ok →', Object.keys(m).slice(0, 6)))"`} />

      <h2>Next</h2>
      <p>
        Continue with <Link href="/docs/getting-started">Getting started</Link> to write your first route.
      </p>
    </>
  );
}
