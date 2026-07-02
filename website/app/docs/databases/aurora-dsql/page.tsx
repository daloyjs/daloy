import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Use AWS Aurora DSQL with DaloyJS",
  description:
    "Connect a DaloyJS API on AWS Lambda or Node.js to Aurora DSQL, AWS's distributed serverless PostgreSQL. Uses IAM-based auth tokens with the standard pg driver.",
  path: "/docs/databases/aurora-dsql",
  keywords: [
    "Aurora DSQL DaloyJS",
    "AWS distributed Postgres",
    "DSQL Lambda",
    "IAM auth Postgres",
    "Aurora DSQL Drizzle",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Use AWS Aurora DSQL with DaloyJS</h1>
      <p>
        <a
          href="https://docs.aws.amazon.com/aurora-dsql/"
          target="_blank"
          rel="noreferrer"
        >
          Aurora DSQL
        </a>{" "}
        is AWS&apos;s serverless, distributed PostgreSQL service. It speaks the Postgres wire protocol,
        so you use the standard <code>pg</code> driver, but auth is short-lived IAM tokens instead of a
        static password. Pair it with the <Link href="/docs/adapters">Lambda adapter</Link> for a fully
        managed AWS-native stack.
      </p>

      <h2 id="1-provision-a-cluster">1. Provision a cluster</h2>
      <p>
        Create a cluster in the AWS console or via the CLI. Note the endpoint hostname and the AWS region.
      </p>
      <CodeBlock
        code={`aws dsql create-cluster --region us-east-1`}
      />

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add pg @aws-sdk/dsql-signer`} />

      <h2 id="3-generate-a-token-and-connect">3. Generate a token and connect</h2>
      <p>
        DSQL tokens expire (default ~15 minutes), so build a connection helper that refreshes the
        password before opening a connection. For Lambda, create one client per invocation; for long-lived
        Node processes, refresh on a timer or on auth errors.
      </p>

      <FlowDiagram
        title="IAM token auth flow"
        numbered
        steps={[
          {
            label: "DsqlSigner",
            detail: "new DsqlSigner({ hostname, region })",
            tone: "accent",
          },
          {
            label: "Sign a token",
            detail: "signer.getDbConnectAdminAuthToken()",
          },
          {
            label: "Short-lived token",
            detail: "expires in ~15 minutes",
          },
          {
            label: "pg Client",
            detail: "password: token · ssl rejectUnauthorized: true",
          },
          {
            label: "client.connect()",
            detail: "Postgres wire protocol over TCP",
            tone: "success",
          },
        ]}
        caption="DSQL replaces a static password with a short-lived IAM token (~15 min). Sign a fresh token per Lambda invocation, or refresh it on a timer for long-lived Node processes."
      />

      <CodeBlock
        code={`// src/db/dsql.ts
import { Client } from "pg";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

const signer = new DsqlSigner({
  hostname: process.env.DSQL_ENDPOINT!,
  region: process.env.AWS_REGION ?? "us-east-1",
});

export async function createDsqlClient() {
  const token = await signer.getDbConnectAdminAuthToken();
  const client = new Client({
    host: process.env.DSQL_ENDPOINT!,
    port: 5432,
    user: "admin",
    password: token,
    database: "postgres",
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}`}
      />

      <h2 id="4-plugin-pattern-long-lived-node">4. Plugin pattern (long-lived Node)</h2>
      <CodeBlock
        code={`// src/db/plugin.ts
import type { App } from "@daloyjs/core";
import { createDsqlClient } from "./dsql";

export const dsqlPlugin = {
  name: "dsql",
  async register(app: App) {
    const client = await createDsqlClient();
    app.decorate("db", client);
    app.onClose(async () => {
      await client.end();
    });
  },
};`}
      />

      <h2 id="5-lambda-pattern-per-invocation">5. Lambda pattern (per-invocation)</h2>
      <p>
        On the <Link href="/docs/adapters">Lambda adapter</Link>, create the client inside the handler
        and close it at the end so the IAM token doesn&apos;t expire between cold starts:
      </p>
      <CodeBlock
        code={`import { toLambdaHandler } from "@daloyjs/core/lambda";
import { createDsqlClient } from "./db/dsql";

const daloyHandler = toLambdaHandler(app);

export const handler = async (event) => {
  const db = await createDsqlClient();
  app.decorate("db", db);
  try {
    return await daloyHandler(event);
  } finally {
    await db.end();
  }
};`}
      />

      <h2 id="6-augment-app-state">6. Augment app state</h2>
      <CodeBlock
        code={`// src/types/state.d.ts
import type { Client } from "pg";

declare module "@daloyjs/core" {
  interface AppState {
    db: Client;
  }
}`}
      />

      <h2 id="with-drizzle-orm">With Drizzle ORM</h2>
      <CodeBlock
        code={`pnpm add drizzle-orm
// src/db/drizzle.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { createDsqlClient } from "./dsql";

export async function createDb() {
  const client = await createDsqlClient();
  return drizzle({ client });
}`}
      />

      <h2 id="with-prisma">With Prisma</h2>
      <p>
        Use the <a href="https://www.prisma.io/docs/orm/overview/databases/postgresql" target="_blank" rel="noreferrer">
          pg Driver Adapter
        </a>{" "}
        and inject a Postgres connection that uses the IAM token. The same caveats as above apply: tokens
        expire, so refresh per Lambda invocation.
      </p>

      <h2 id="things-to-remember">Things to remember</h2>
      <ul>
        <li>
          DSQL is <strong>TCP</strong>-only, so it does <em>not</em> work on Cloudflare Workers or Vercel
          Edge. Use <Link href="/docs/databases/neon">Neon</Link> or{" "}
          <Link href="/docs/databases/planetscale">PlanetScale</Link> there.
        </li>
        <li>
          IAM tokens expire, refresh on every Lambda invocation, or wrap re-connection logic around
          long-lived Node processes.
        </li>
        <li>
          DSQL has Postgres-compatible semantics but not 100% feature parity. Check the{" "}
          <a
            href="https://docs.aws.amazon.com/aurora-dsql/latest/userguide/known-issues.html"
            target="_blank"
            rel="noreferrer"
          >
            known issues
          </a>{" "}
          before relying on niche extensions.
        </li>
      </ul>

      <p>
        See also the <Link href="/docs/databases">database hosting overview</Link> or jump back to{" "}
        <Link href="/docs/orm/prisma">Prisma</Link> /{" "}
        <Link href="/docs/orm/drizzle">Drizzle</Link>.
      </p>
    </>
  );
}
