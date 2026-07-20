import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { BranchDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Netlify adapter",
  description:
    "Deploy DaloyJS to Netlify Edge Functions (Deno) or Netlify Functions v2 (Node fetch-style). Both share the same Request → Response model.",
  path: "/docs/adapters/netlify",
  keywords: [
    "DaloyJS Netlify adapter",
    "Netlify Edge Functions",
    "Netlify Functions v2",
    "Netlify fetch handler",
    "netlify.toml",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Netlify</h1>
      <p>
        Netlify gives you two runtime options for an API:{" "}
        <strong>Edge Functions</strong> (Deno-based, global) and{" "}
        <strong>Functions v2</strong> (Node, fetch-style). Both speak the
        web-standard <code>Request → Response</code> contract, so the DaloyJS
        adapter is the same helper in both places. Only the file location and
        the optional config export change.
      </p>

      <BranchDiagram
        title="One app, two Netlify targets"
        source={{
          eyebrow: "identical app",
          label: "Your DaloyJS App",
          detail: "Request → Response",
        }}
        branches={[
          {
            eyebrow: "deno · global",
            label: "Edge Functions",
            detail: "netlify/edge-functions/ · toWebHandler(app)",
          },
          {
            eyebrow: "node · recommended",
            label: "Functions v2",
            detail: "netlify/functions/*.mts · toWebHandler(app)",
          },
          {
            eyebrow: "legacy v1",
            label: "Lambda-shape handler",
            detail: "toLambdaHandler(app)",
            tone: "muted",
          },
        ]}
        caption="Edge and Functions v2 both speak Request → Response, so they share toWebHandler; only the file location and config export change. The v1 lambda shape is legacy and only for codebases that cannot move to v2."
      />

      <h2 id="when-to-choose-netlify">When to choose Netlify</h2>
      <ul>
        <li>
          You want a platform-managed REST API with Edge or Node function
          options.
        </li>
        <li>You want preview deploys per branch with zero config.</li>
        <li>You&apos;re fine with platform-managed cold starts.</li>
      </ul>

      <h2 id="netlify-edge-functions-deno">Netlify Edge Functions (Deno)</h2>
      <p>
        Edge Functions run on a Deno-based runtime. Use{" "}
        <code>toWebHandler</code>
        {", "}the same helper as the Vercel adapter, because the input/output
        shape is identical.
      </p>
      <CodeBlock
        language="ts"
        code={`// netlify/edge-functions/api.ts
import { toWebHandler } from "@daloyjs/core/vercel";
import type { Config } from "@netlify/edge-functions";
import { app } from "../../src/server.ts";

export default toWebHandler(app);

export const config: Config = {
  path: "/api/*",
};`}
      />

      <h2 id="netlify-functions-v2-node-fetch-style">
        Netlify Functions v2 (Node, fetch-style)
      </h2>
      <p>
        Functions v2 is GA and is the recommended way to write Node functions on
        Netlify. The old v1 lambda-style handler (
        <code>exports.handler = (event, context) =&gt; ...</code>) is legacy. It
        still works for compatibility but you should write new code in v2.
      </p>
      <CodeBlock
        language="ts"
        code={`// netlify/functions/api.mts
import { toWebHandler } from "@daloyjs/core/vercel";
import type { Config } from "@netlify/functions";
import { app } from "../../src/server.js";

export default toWebHandler(app);

export const config: Config = {
  path: "/api/*",
};`}
      />
      <p>
        If you have an existing v1 codebase you can&apos;t migrate yet, the
        Lambda adapter still works against the v1 event shape:
      </p>
      <CodeBlock
        language="ts"
        code={`// netlify/functions/api.ts (legacy v1, only if you can't move to v2)
import { toLambdaHandler } from "@daloyjs/core/lambda";
import { app } from "../../src/server.js";

export const handler = toLambdaHandler(app);`}
      />

      <h2 id="netlify-toml">netlify.toml</h2>
      <p>
        For a REST-API-only project there is no static site to publish. Omit the{" "}
        <code>publish</code> key (or point it at an empty directory) so Netlify
        doesn&apos;t try to serve your compiled server code as static files.
      </p>
      <CodeBlock
        language="toml"
        code={`[build]
  command = "pnpm build"

[functions]
  node_bundler = "esbuild"

# only needed if you don't use the config export above
[[edge_functions]]
  function = "api"
  path = "/api/*"`}
      />

      <h2 id="deploy">Deploy</h2>
      <CodeBlock
        language="bash"
        code={`pnpm netlify dev
pnpm netlify deploy --build
pnpm netlify deploy --build --prod`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          Edge Functions don&apos;t expose <code>node:*</code>
          {", "}the same caveat as Vercel and Cloudflare Workers.
        </li>
        <li>
          Functions v2 returns a <code>Response</code> directly. Don&apos;t use
          the v1 <code>statusCode</code>/<code>body</code> object shape in v2
          code.
        </li>
        <li>
          <code>context.waitUntil</code> is available in v2 for fire-and-forget
          work.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/deno">Deno adapter</Link>
        </li>
        <li>
          <Link href="/docs/adapters/aws-lambda">AWS Lambda adapter</Link>
        </li>
      </ul>
    </>
  );
}
