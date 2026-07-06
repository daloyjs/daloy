import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Config validation",
  description:
    "Validate application configuration at boot with defineConfig(): load from env, a file, or an async secrets resolver, validate against any Standard Schema validator, and fail fast with every issue reported at once.",
  path: "/docs/config",
  keywords: [
    "DaloyJS config",
    "defineConfig",
    "config validation",
    "env validation",
    "fail fast configuration",
    "Standard Schema config",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Config validation</h1>
      <blockquote>
        <strong>Think of it like…</strong> a pre-flight checklist. Instead of
        taking off and discovering the fuel gauge is broken at 30,000 feet, you
        catch every problem on the ground, and you get the whole list at once,
        not one redeploy at a time.
      </blockquote>
      <p>
        <code>defineConfig()</code> is a single boot-time helper that loads your
        application configuration from a source you choose, validates the merged
        object against a Standard Schema validator (Zod, Valibot, ArkType,
        TypeBox, and others), and aggregates <strong>every</strong> validation
        issue into one structured error printed to stderr before startup
        continues.
      </p>
      <p>
        The point is to fail fast and loud: a misconfigured deployment should
        surface every missing or invalid key in one shot, so operators do not
        have to redeploy four times to discover four different typos.
      </p>

      <FlowDiagram
        numbered
        title="What defineConfig() does at boot"
        steps={[
          {
            eyebrow: "source",
            label: "Load raw values",
            detail: "env, file, object, or custom resolver",
          },
          {
            eyebrow: "transform",
            label: "Coerce & rename",
            detail: "optional transform(raw)",
            tone: "muted",
          },
          {
            eyebrow: "validate",
            label: "Check Standard Schema",
            detail: "Zod, Valibot, ArkType, TypeBox",
            tone: "accent",
          },
          {
            eyebrow: "ok",
            label: "Typed config",
            detail: "fully inferred from your schema",
            tone: "success",
          },
        ]}
        caption="On success you get a typed config object. On failure defineConfig() aggregates every issue into one ConfigValidationError and exits before the server binds a port."
      />

      <h2 id="quick-start-from-the-environment">Quick start (from the environment)</h2>
      <p>
        By default <code>defineConfig()</code> reads from{" "}
        <code>process.env</code>. The result is fully typed from your schema.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { defineConfig } from "@daloyjs/core";

const Config = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

// Top-level await at module scope; resolves only when validation passed.
export const config = await defineConfig({ schema: Config });

// config.PORT is a number, config.DATABASE_URL is a string, etc.`}
      />
      <p>
        If any key is missing or malformed, the process prints a summary and
        throws before your server ever binds a port:
      </p>
      <CodeBlock
        language="text"
        code={`defineConfig(): configuration is invalid (2 issues)
  - PORT: Invalid input: expected number, received NaN
  - DATABASE_URL: Invalid URL`}
      />

      <h2 id="use-the-validated-config">Use the validated config</h2>
      <p>
        Load configuration before constructing the app, then pass the typed
        values into DaloyJS options and your runtime adapter:
      </p>
      <CodeBlock
        language="ts"
        code={`import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";
import { config } from "./config.js";

const app = new App({
  env: config.NODE_ENV,
  openapi: { info: { title: "API", version: "1.0.0" } },
  docs: config.NODE_ENV !== "production",
});

serve(app, { port: config.PORT });`}
      />

      <h2 id="choosing-a-source">Choosing a source</h2>
      <p>
        The <code>source</code> option selects where the raw object comes from.
        The built-in sources are intentionally narrow; anything more elaborate
        (Vault, Doppler, AWS Secrets Manager) arrives through the{" "}
        <code>custom</code> source with an async resolver.
      </p>
      <p>
        File sources read through <code>node:fs/promises</code>. On edge
        runtimes, prefer <code>env</code>, <code>object</code>, or{" "}
        <code>custom</code> sources supplied by the platform.
      </p>
      <CodeBlock
        language="ts"
        code={`// Default: read from process.env
await defineConfig({ schema: Config });
await defineConfig({ schema: Config, source: "env" });

// Read from an explicit env map (handy in tests)
await defineConfig({ schema: Config, source: { kind: "env", env: customEnv } });

// Read and parse a file on disk (defaults to JSON.parse)
await defineConfig({
  schema: Config,
  source: { kind: "file", path: "./config.json" },
});

// Use a custom parser for dotenv, INI, TOML, or another text format
await defineConfig({
  schema: Config,
  source: {
    kind: "file",
    path: "./config.env",
    parse: (text) =>
      Object.fromEntries(
        text
          .trim()
          .split("\\n")
          .map((line) => {
            const [key, ...value] = line.split("=");
            return [key.trim(), value.join("=").trim()];
          }),
      ),
  },
});

// Validate an in-memory object
await defineConfig({
  schema: Config,
  source: {
    kind: "object",
    data: {
      PORT: "3000",
      DATABASE_URL: "https://example.com/db",
      NODE_ENV: "test",
    },
  },
});

// Pull from an async secrets resolver
await defineConfig({
  schema: Config,
  source: { kind: "custom", resolve: async () => fetchSecretsFromVault() },
});`}
      />

      <h2 id="transforming-before-validation">Transforming before validation</h2>
      <p>
        Use <code>transform</code> to coerce or rename raw values before they
        hit the schema, for example mapping <code>FOO_BAR</code> to{" "}
        <code>fooBar</code>, or normalizing string flags. It receives the raw
        source object and returns the object handed to the validator.
      </p>
      <CodeBlock
        language="ts"
        code={`await defineConfig({
  schema: Config,
  transform: (raw) => ({
    ...raw,
    FEATURE_FLAGS: String(raw.FEATURE_FLAGS ?? "").split(","),
  }),
});`}
      />

      <h2 id="handling-the-error-programmatically">Handling the error programmatically</h2>
      <p>
        On failure, <code>defineConfig()</code> throws a{" "}
        <code>ConfigValidationError</code> whose <code>issues</code> array holds
        every <code>&#123; key, message &#125;</code> pair. Catch it when you
        want to render the failures in a startup probe or dashboard instead of
        relying on the stderr summary.
      </p>
      <CodeBlock
        language="ts"
        code={`import { defineConfig, ConfigValidationError } from "@daloyjs/core";

try {
  const config = await defineConfig({ schema: Config });
  startServer(config);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    for (const issue of err.issues) {
      reportToHealthDashboard(issue.key, issue.message);
    }
  }
  throw err;
}`}
      />
      <p>
        The stderr summary is on by default. Set <code>stderr: false</code> to
        suppress the printed output; the thrown{" "}
        <code>ConfigValidationError</code> still carries <code>issues</code>.
      </p>
    </>
  );
}
