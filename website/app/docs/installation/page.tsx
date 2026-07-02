import { CodeBlock } from "../../../components/code-block";
import Link from "next/link";

import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Installation",
  description:
    "Install DaloyJS with pnpm, npm, yarn, or bun. Set up the framework on Node.js, Bun, Deno, Cloudflare Workers, or Vercel in minutes.",
  path: "/docs/installation",
  keywords: [
    "install DaloyJS",
    "pnpm add daloyjs",
    "DaloyJS setup",
    "TypeScript framework install",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Installation</h1>
      <p>
        DaloyJS targets <strong>Node.js ≥ 24.0.0 (active LTS)</strong> and is
        distributed on the public npm registry as <code>@daloyjs/core</code>.
        The package has <strong>no peer dependencies</strong>, so{" "}
        <code>npm</code>, <code>yarn</code>, <code>pnpm</code>, and{" "}
        <code>bun</code> can all install it directly. We <em>recommend</em>{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">
          pnpm
        </a>{" "}
        together with the hardened <code>.npmrc</code> defaults below for
        supply-chain reasons, but it is not required. The{" "}
        <code>engines.pnpm</code> entry in <code>package.json</code> is advisory
        metadata, while <code>engines.node</code> communicates the supported
        runtime and may warn or fail depending on your package manager and
        engine-strict settings.
      </p>

      <FlowDiagram
        numbered
        title="Two ways in"
        steps={[
          {
            eyebrow: "fastest",
            label: "Scaffold",
            detail: "pnpm create daloy@latest",
            tone: "accent",
          },
          {
            eyebrow: "or",
            label: "Install into a project",
            detail: "pnpm add @daloyjs/core zod",
          },
          {
            eyebrow: "harden",
            label: "Add .npmrc defaults",
            detail: "strict-peer-dependencies, frozen lockfile",
            tone: "muted",
          },
          {
            eyebrow: "confirm",
            label: "Verify the import",
            detail: "node -e import('@daloyjs/core')",
            tone: "success",
          },
        ]}
        caption="Either scaffold a hardened project in one command or add the dependency-free package to an existing one, then drop in the hardened .npmrc and verify the import resolves."
      />

      <h2 id="fastest-path-scaffold-a-project">Fastest path: scaffold a project</h2>
      <p>
        Use the official generator, it sets up a hardened <code>.npmrc</code>,
        strict TypeScript, and a working route in one command.
      </p>
      <p>
        Package links:{" "}
        <a
          href="https://www.npmjs.com/package/create-daloy"
          target="_blank"
          rel="noreferrer"
        >
          create-daloy on npm
        </a>{" "}
        and{" "}
        <a
          href="https://www.npmjs.com/package/@daloyjs/core"
          target="_blank"
          rel="noreferrer"
        >
          @daloyjs/core on npm
        </a>
        .
      </p>
      <CodeBlock
        language="bash"
        code={`# choose one package manager
pnpm create daloy@latest my-api
npm  create daloy@latest my-api
yarn create daloy           my-api
bun  create daloy           my-api`}
      />
      <p>
        See <Link href="/docs/scaffolder">Scaffold a project</Link> for
        templates and flags.
      </p>

      <h2 id="or-install-into-an-existing-project">Or install into an existing project</h2>

      <h3 id="prerequisites">Prerequisites</h3>
      <ul>
        <li>
          <strong>Node.js</strong> 24.0.0 or newer (active LTS).
        </li>
        <li>
          A package manager. Any of these works, pnpm 11.x or newer is
          recommended for supply-chain hardening, but <code>npm</code>,{" "}
          <code>yarn</code>, and <code>bun</code> install{" "}
          <code>@daloyjs/core</code> cleanly because the package has no peer
          dependencies.
        </li>
      </ul>
      <p>
        To enable pnpm via{" "}
        <a
          href="https://nodejs.org/api/corepack.html"
          target="_blank"
          rel="noreferrer"
        >
          Corepack
        </a>
        :
      </p>
      <CodeBlock
        language="bash"
        code={`corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm --version`}
      />

      <h3 id="install-daloyjs">Install DaloyJS</h3>
      <CodeBlock
        language="bash"
        code={`# choose one package manager
pnpm add @daloyjs/core zod
npm  install @daloyjs/core zod
yarn add     @daloyjs/core zod
bun  add     @daloyjs/core zod
# optional - only if you want to generate a typed SDK
pnpm add -D typescript @hey-api/openapi-ts prettier
npm  install -D typescript @hey-api/openapi-ts prettier
yarn add -D     typescript @hey-api/openapi-ts prettier
bun  add -d     typescript @hey-api/openapi-ts prettier`}
      />
      <p>
        The framework package published to npm is{" "}
        <a
          href="https://www.npmjs.com/package/@daloyjs/core"
          target="_blank"
          rel="noreferrer"
        >
          @daloyjs/core
        </a>
        .
      </p>

      <h2 id="hardened-npmrc">
        Hardened <code>.npmrc</code>
      </h2>
      <p>
        Drop this <code>.npmrc</code> in your project root to make pnpm reject
        unsafe installs by default:
      </p>
      <CodeBlock
        language="ini"
        code={`auto-install-peers=true
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
minimum-release-age=1440
ignore-scripts=true`}
      />

      <p>
        Read the rationale in <Link href="/docs/security">Security</Link> and
        the{" "}
        <a href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">
          pnpm motivation guide
        </a>
        .
      </p>

      <h2 id="verify">Verify</h2>
      <p>
        Run this from the project root after installing, it works the same under
        pnpm, npm, yarn, or bun because it shells straight to <code>node</code>:
      </p>
      <CodeBlock
        language="bash"
        code={`node -e "import('@daloyjs/core').then(m => console.log('DaloyJS ok →', Object.keys(m).slice(0, 6)))"`}
      />

      <h2 id="next">Next</h2>
      <p>
        Continue with <Link href="/docs/getting-started">Getting started</Link>{" "}
        to write your first route.
      </p>
    </>
  );
}
