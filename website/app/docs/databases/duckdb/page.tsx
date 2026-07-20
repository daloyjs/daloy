import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use DuckDB with DaloyJS",
  description:
    "Use DuckDB from a DaloyJS API for embedded OLAP analytics in Node.js. Covers @duckdb/node-api, plugin setup, parameterized SQL, JSON-safe result conversion, runtime limits, and security hardening.",
  path: "/docs/databases/duckdb",
  keywords: [
    "DuckDB DaloyJS",
    "@duckdb/node-api",
    "DuckDB Node API",
    "embedded OLAP",
    "Parquet analytics",
    "DuckDB security",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use DuckDB with DaloyJS</h1>
      <p>
        <a href="https://duckdb.org" target="_blank" rel="noreferrer">
          DuckDB
        </a>{" "}
        is an in-process OLAP database. Use it when your DaloyJS API needs to
        query local analytical data, Parquet files, CSV exports, or a small
        embedded reporting database without running a separate database server.
        It is not a replacement for Postgres or MySQL as the primary
        transactional database behind a multi-writer API.
      </p>

      <BranchDiagram
        title="Where DuckDB fits"
        source={{
          eyebrow: "daloy route",
          label: "handler",
          detail: "validated HTTP request",
        }}
        branches={[
          {
            eyebrow: "good fit",
            label: "Embedded analytics",
            detail: "Parquet, CSV, local .duckdb files, reporting queries",
            tone: "success",
          },
          {
            eyebrow: "bad fit",
            label: "Shared transactional store",
            detail: "many app replicas writing the same primary data",
            tone: "danger",
          },
        ]}
        caption="DuckDB runs inside the process. That makes it excellent for local analytics and data APIs, but not the right default for shared OLTP state across many API instances."
      />

      <h2 id="1-install">1. Install</h2>
      <p>
        Use the modern Node client. The older <code>duckdb</code> package is not
        the client this guide targets.
      </p>
      <CodeBlock code={`pnpm add @duckdb/node-api`} />

      <h2 id="2-create-a-duckdb-plugin">2. Create a DuckDB plugin</h2>
      <p>
        Create one instance per process and connect during app startup. Use an
        in-memory database for transient analytics, or point DuckDB at a
        persisted file when the platform gives you durable disk.
      </p>
      <CodeBlock
        code={`// src/db/duckdb.ts
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { App } from "@daloyjs/core";

export type DuckDbState = {
  duckdb: DuckDBConnection;
};

export const duckDbPlugin = {
  name: "duckdb",
  async register(app: App) {
    const path = process.env.DUCKDB_PATH ?? ":memory:";
    const instance = await DuckDBInstance.fromCache(path);
    const connection = await instance.connect();

    app.decorate("duckdb", connection);
    app.onClose(() => {
      connection.closeSync();
    });
  },
};`}
      />

      <h2 id="3-augment-app-state">3. Augment app state</h2>
      <p>
        Add the <code>declare module</code> block to the same module that
        creates the plugin, not to a separate <code>.d.ts</code> file.
        Declaration files are exempt from type-checking when{" "}
        <code>skipLibCheck</code> is on (the scaffolded default), so a broken
        import inside a <code>.d.ts</code> fails silently and{" "}
        <code>state.duckdb</code> quietly degrades to <code>any</code>.
      </p>
      <CodeBlock
        code={`// src/db/duckdb.ts (same module as the plugin above)
declare module "@daloyjs/core" {
  interface AppState {
    duckdb: DuckDBConnection;
  }
}`}
      />

      <h2 id="4-query-from-a-route">4. Query from a route</h2>
      <p>
        Keep SQL structure owned by the server and pass request values as
        parameters. Convert results to JSON-safe objects before returning them
        through a response schema.
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import { duckDbPlugin } from "./db/duckdb.ts";

const app = new App();
app.use(secureHeaders());
app.register(duckDbPlugin);

const SalesSummary = z.object({
  region: z.string(),
  revenue: z.number(),
});

app.get(
  "/analytics/sales",
  {
    operationId: "salesSummary",
    request: { query: z.object({ region: z.string().min(1).optional() }) },
    responses: {
      200: { description: "ok", body: z.array(SalesSummary) },
    },
  },
  async ({ query, state }) => {
    const reader = await state.duckdb.runAndReadAll(
      \`select region, sum(revenue)::double as revenue
       from read_parquet('data/sales/*.parquet')
       where $region is null or region = $region
       group by region
       order by revenue desc\`,
      { region: query.region ?? null },
    );

    return {
      status: 200,
      body: SalesSummary.array().parse(reader.getRowObjectsJson()),
    };
  },
);`}
      />

      <h2 id="runtime-support">Runtime support</h2>
      <table>
        <thead>
          <tr>
            <th>Runtime</th>
            <th>Fit</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Node.js</td>
            <td>Recommended</td>
            <td>
              <code>@duckdb/node-api</code> is a native Node client.
            </td>
          </tr>
          <tr>
            <td>Bun / Deno</td>
            <td>Limited</td>
            <td>
              Prefer Node unless you have tested the native package and deploy
              target yourself.
            </td>
          </tr>
          <tr>
            <td>Cloudflare Workers</td>
            <td>No</td>
            <td>Workers cannot load the native Node package.</td>
          </tr>
          <tr>
            <td>AWS Lambda / containers</td>
            <td>Yes</td>
            <td>
              Works when the native package matches the deployment platform and
              any persisted files live on durable storage.
            </td>
          </tr>
        </tbody>
      </table>

      <h2 id="use-the-right-storage-mode">Use the right storage mode</h2>
      <FlowDiagram
        title="Storage choice"
        numbered
        steps={[
          {
            label: ":memory:",
            detail: "scratch reports, tests, temp imports",
            eyebrow: "ephemeral",
          },
          {
            label: "file.duckdb",
            detail: "single-process durable local database",
          },
          {
            label: "Parquet / CSV",
            detail: "data lake, exports, read-heavy analytics",
            tone: "accent",
          },
          {
            label: "Postgres / MySQL",
            detail: "primary transactional app state",
            tone: "success",
          },
        ]}
        caption="Use DuckDB for analytical reads and local processing. Keep primary multi-user writes in a transactional database unless you have a carefully controlled single-writer design."
      />

      <h2 id="security-notes">Security notes</h2>
      <ul>
        <li>
          Do not execute SQL text from users. DuckDB SQL can read files, access
          networks through extensions, and consume significant CPU or memory.
        </li>
        <li>
          Use parameterized values when request data belongs in a query, as in
          the route above.
        </li>
        <li>
          Disable external access for routes that only query in-memory tables or
          controlled data:
        </li>
      </ul>
      <CodeBlock
        code={`await state.duckdb.run("set enable_external_access = false");
await state.duckdb.run("set allow_community_extensions = false");
await state.duckdb.run("set lock_configuration = true");`}
      />
      <ul>
        <li>
          If you need file reads, restrict the directories and never pass a user
          supplied path directly into <code>read_csv</code>
          {", "}
          <code>read_parquet</code>
          {", "}<code>COPY</code>
          {", "}or <code>ATTACH</code>.
        </li>
        <li>
          For user-authored SQL, run DuckDB out of process with OS/container
          sandboxing and strict timeouts. A DaloyJS route should treat
          user-authored SQL like code execution, not like a search filter.
        </li>
      </ul>

      <h2 id="when-to-choose-duckdb">When to choose DuckDB</h2>
      <ul>
        <li>You need analytics over Parquet, CSV, JSON, or local snapshots.</li>
        <li>
          You want an embedded reporting endpoint in a Node service without
          operating a warehouse.
        </li>
        <li>
          You are building import/export, admin analytics, billing summaries, or
          offline data tools.
        </li>
      </ul>

      <h2 id="when-not-to-choose-it">When not to choose it</h2>
      <ul>
        <li>
          You need many API replicas to write the same primary application data.
        </li>
        <li>
          You deploy only to Cloudflare Workers. Use{" "}
          <Link href="/docs/databases/turso">Turso</Link>
          {", "}
          <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link>
          {", "}or <Link href="/docs/databases/neon">Neon</Link> instead.
        </li>
        <li>
          You want row-level authorization enforced inside the database. Keep
          that in Postgres/Supabase or enforce it explicitly in application
          code.
        </li>
      </ul>

      <p>
        See also the{" "}
        <Link href="/docs/databases">database hosting overview</Link>
        {", "}
        <Link href="/docs/adapters/node">Node adapter</Link>
        {", "}and{" "}
        <a
          href="https://duckdb.org/docs/lts/clients/node_neo/overview"
          target="_blank"
          rel="noreferrer"
        >
          DuckDB Node.js client docs
        </a>
        {"."}
      </p>
    </>
  );
}
