import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { LayerStack } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deno adapter",
  description:
    "Run a DaloyJS REST API on Deno using the stable Deno.serve API with AbortSignal-based graceful shutdown and built-in TLS.",
  path: "/docs/adapters/deno",
  keywords: [
    "DaloyJS Deno adapter",
    "Deno.serve",
    "Deno TLS",
    "Deno graceful shutdown",
    "AbortController Deno",
    "Deno Deploy",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Deno</h1>
      <p>
        The Deno adapter wraps <code>Deno.serve</code>: the stable, modern entry
        point that replaced the old <code>Deno.serveHttp</code>. Graceful
        shutdown uses an <code>AbortController</code>, which is the pattern Deno
        itself recommends.
      </p>

      <LayerStack
        title="Deno adapter stack"
        layers={[
          {
            title: "Your DaloyJS App",
            detail: "routes · hooks · handlers",
            tone: "accent",
          },
          {
            title: "Deno adapter",
            detail: "serve(app) wraps Deno.serve",
            items: ["signal", "onListen", "cert/key"],
          },
          {
            title: "Deno runtime",
            detail: "stable Deno.serve, TS built in",
            tone: "muted",
          },
        ]}
        caption="serve() drives the stable Deno.serve and threads an AbortController signal through for graceful shutdown. The same src/server.ts runs locally and on Deno Deploy."
      />

      <h2>When to choose Deno</h2>
      <ul>
        <li>
          You want a web-standard runtime with TypeScript built in and no
          transpile step.
        </li>
        <li>
          You deploy to Deno Deploy, or to a container running the official Deno
          image.
        </li>
        <li>
          You like Deno&apos;s permissions model and don&apos;t need the full
          npm ecosystem.
        </li>
      </ul>

      <h2>Scaffold</h2>
      <p>
        The <code>deno-basic</code> template ships a Deno-native server with a{" "}
        <code>deno.json</code> import map, watch-mode dev, and{" "}
        <code>deno test</code>.
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm create daloy@latest my-api --template deno-basic
cd my-api
deno task dev    # deno run --allow-net --allow-env --allow-read --watch`}
      />

      <h2>Install</h2>
      <p>
        <code>@daloyjs/core</code> is published to npm. Deno can consume it
        directly via the <code>npm:</code> specifier. This is the same
        pattern used by the official <code>deno-basic</code> scaffolder
        template.
      </p>
      <CodeBlock
        language="jsonc"
        code={`// deno.json
{
  "imports": {
    "@daloyjs/core":  "npm:@daloyjs/core@^1.0.0-beta.6",
    "@daloyjs/core/": "npm:@daloyjs/core@^1.0.0-beta.6/",
    "zod":            "npm:zod@^4.4.3"
  }
}`}
      />

      <h2>Minimal server</h2>
      <CodeBlock
        language="ts"
        code={`// src/server.ts
import { serve } from "@daloyjs/core/deno";
import { app } from "./app.ts";

const ac = new AbortController();

serve(app, {
  port: 3000,
  hostname: "0.0.0.0",
  signal: ac.signal,
  onListen: ({ hostname, port }) =>
    console.log(\`listening on http://\${hostname}:\${port}\`),
  // HTTPS:
  // cert: Deno.readTextFileSync("./cert.pem"),
  // key:  Deno.readTextFileSync("./key.pem"),
});

Deno.addSignalListener("SIGTERM", () => ac.abort());
Deno.addSignalListener("SIGINT", () => ac.abort());`}
      />

      <h2>Run it</h2>
      <CodeBlock
        language="bash"
        code={`deno run --allow-net --allow-env --allow-read src/server.ts`}
      />

      <h2>Deploy to Deno Deploy</h2>
      <p>
        Deno Deploy reads the entry script directly. Point your project at{" "}
        <code>src/server.ts</code>; the same file you run locally is what runs
        in production.
      </p>
      <CodeBlock
        language="bash"
        code={`# install once
deno install -gArf jsr:@deno/deployctl

# deploy
deployctl deploy --project=my-api src/server.ts`}
      />

      <h2>Dockerfile</h2>
      <CodeBlock
        language="docker"
        code={`FROM denoland/deno:distroless
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "src/server.ts"]`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          Don&apos;t use <code>Deno.serveHttp</code>: it&apos;s deprecated. The
          DaloyJS adapter uses <code>Deno.serve</code> exclusively.
        </li>
        <li>
          On Deno Deploy you don&apos;t get <code>SIGTERM</code>; the platform
          manages shutdown. The <code>AbortController</code> wiring above is for
          self-hosted Deno only.
        </li>
        <li>
          Use <code>--allow-net</code> (and others) explicitly, Deno&apos;s
          default-deny permissions are the point.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/netlify">Netlify Edge Functions</Link>:
          also Deno-based.
        </li>
      </ul>
    </>
  );
}
