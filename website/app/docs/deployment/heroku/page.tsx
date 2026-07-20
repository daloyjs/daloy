import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deploy to Heroku",
  description:
    "Deploy DaloyJS to Heroku as a Node web dyno. Procfile, heroku-24 or heroku-26 stack, and the heroku/nodejs buildpack.",
  path: "/docs/deployment/heroku",
  keywords: [
    "Deploy DaloyJS to Heroku",
    "Heroku Procfile",
    "heroku-24 stack",
    "heroku/nodejs buildpack",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Heroku</h1>
      <p>
        Heroku still runs DaloyJS happily as a Node web dyno. Use the{" "}
        <Link href="/docs/adapters/node">Node adapter</Link>
        {", "}declare a <code>Procfile</code>
        {", "}and pin to a supported stack.
      </p>

      <FlowDiagram
        title="git push deploy pipeline"
        numbered
        steps={[
          {
            label: "git push heroku main",
            detail: "heroku-24 / heroku-26 stack",
            eyebrow: "git",
          },
          {
            label: "heroku/nodejs buildpack",
            detail: "auto-detected from package.json",
          },
          {
            label: "Procfile web dyno",
            detail: "web: node dist/server.js",
            tone: "accent",
          },
          {
            label: "Graceful shutdown",
            detail: "SIGTERM, shutdownTimeoutMs < 30s",
            tone: "success",
          },
        ]}
        caption="A push builds with the auto-detected heroku/nodejs buildpack and boots the Procfile web dyno bound to PORT. On a redeploy Heroku sends SIGTERM then SIGKILL after 30 seconds, so keep shutdownTimeoutMs well under that."
      />

      <h2 id="when-to-choose-heroku">When to choose Heroku</h2>
      <ul>
        <li>
          You already have Heroku add-ons and pipelines and don&apos;t want to
          migrate.
        </li>
        <li>You want a known, stable deploy story without a YAML file.</li>
      </ul>

      <h2 id="server-entrypoint">Server entrypoint</h2>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/node";
import { app } from "./app.js";

serve(app, {
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
});`}
      />

      <h2 id="procfile">Procfile</h2>
      <CodeBlock language="text" code={`web: node dist/server.js`} />

      <h2 id="stack">Stack</h2>
      <p>
        Use <code>heroku-24</code> or <code>heroku-26</code>
        {". "}
        <code>heroku-22</code> is deprecated.
      </p>
      <CodeBlock
        language="bash"
        code={`heroku stack:set heroku-24 --app my-daloy-api`}
      />

      <h2 id="buildpack">Buildpack</h2>
      <p>
        The <code>heroku/nodejs</code> buildpack is auto-detected from{" "}
        <code>package.json</code>.
      </p>
      <CodeBlock
        language="bash"
        code={`heroku buildpacks:set heroku/nodejs --app my-daloy-api`}
      />

      <h2 id="deploy">Deploy</h2>
      <CodeBlock
        language="bash"
        code={`heroku create my-daloy-api --stack heroku-24
heroku config:set SESSION_SECRET=...
git push heroku main`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          Heroku sends <code>SIGTERM</code> and then <code>SIGKILL</code> after
          30 seconds. Set the Node adapter&apos;s <code>shutdownTimeoutMs</code>{" "}
          to something well under 30,000.
        </li>
        <li>
          Bind to <code>0.0.0.0</code> on the <code>PORT</code> env var or the
          routing layer won&apos;t reach the process.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/deployment">Deployment overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/node">Node adapter</Link>
        </li>
      </ul>
    </>
  );
}
