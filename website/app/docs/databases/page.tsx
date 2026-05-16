import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Database hosting & serverless data providers",
  description:
    "Pick the right managed database host for a DaloyJS API: Neon, PlanetScale, Supabase, Turso, Cloudflare D1, and AWS Aurora DSQL. Compares runtime support and which providers work on Cloudflare Workers and Vercel Edge.",
  path: "/docs/databases",
  keywords: [
    "DaloyJS database hosting",
    "serverless Postgres",
    "edge database",
    "Neon DaloyJS",
    "PlanetScale DaloyJS",
    "Turso DaloyJS",
    "Cloudflare D1 DaloyJS",
    "Aurora DSQL DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Database hosting &amp; serverless data providers</h1>
      <p>
        DaloyJS doesn&apos;t ship a database. It runs on Node, Bun, Deno, Cloudflare Workers, Vercel Edge,
        AWS Lambda, Deno Deploy, and Fastly Compute, so the right database depends on which{" "}
        <Link href="/docs/adapters">adapter</Link> you target.
      </p>
      <p>
        The pages in this section cover <strong>where your data lives</strong> — managed hosts and their
        drivers — separately from <strong>how you query it</strong> (see{" "}
        <Link href="/docs/orm">ORMs</Link> and <Link href="/docs/odm">ODMs</Link>). Most providers here
        pair with Drizzle or Prisma rather than replacing them.
      </p>

      <h2>Why this matters on edge runtimes</h2>
      <p>
        Cloudflare Workers and Vercel Edge don&apos;t expose raw TCP sockets, so the classic{" "}
        <code>pg</code> or <code>mysql2</code> drivers will not connect directly. The providers below
        solve that by offering an <strong>HTTP / WebSocket driver</strong>, an{" "}
        <strong>HTTP data API</strong>, or a runtime-native binding. Pick a host whose driver matches the
        runtime you ship to.
      </p>

      <h2>Supported providers</h2>
      <ul>
        <li>
          <Link href="/docs/databases/neon">Neon</Link> — serverless Postgres with branching,
          scale-to-zero, and an HTTP/WebSocket driver (<code>@neondatabase/serverless</code>).
        </li>
        <li>
          <Link href="/docs/databases/planetscale">PlanetScale</Link> — managed MySQL with Vitess,
          branching, deploy requests, and an HTTP driver (<code>@planetscale/database</code>).
        </li>
        <li>
          <Link href="/docs/orm/supabase">Supabase</Link> — hosted Postgres plus auth, storage, and
          realtime via the fetch-based <code>@supabase/supabase-js</code>.
        </li>
        <li>
          <Link href="/docs/databases/turso">Turso</Link> — distributed libSQL (SQLite fork) via{" "}
          <code>@libsql/client</code>; works over HTTP for edge runtimes.
        </li>
        <li>
          <Link href="/docs/databases/cloudflare-d1">Cloudflare D1</Link> — SQLite-compatible database
          bundled with Workers, accessed through a runtime binding (no network driver).
        </li>
        <li>
          <Link href="/docs/databases/aurora-dsql">AWS Aurora DSQL</Link> — distributed PostgreSQL on
          AWS, ideal for the <Link href="/docs/adapters">Lambda adapter</Link>.
        </li>
      </ul>

      <h2>Runtime compatibility</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Driver style</th>
            <th>Node.js</th>
            <th>Bun / Deno</th>
            <th>Cloudflare Workers</th>
            <th>Vercel Edge</th>
            <th>AWS Lambda</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Neon</td>
            <td>HTTP &amp; WebSocket</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>PlanetScale</td>
            <td>HTTP</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Supabase</td>
            <td>fetch-based</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Turso (libSQL)</td>
            <td>HTTP &amp; WebSocket</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Cloudflare D1</td>
            <td>Workers binding</td>
            <td>No (local dev only)</td>
            <td>No</td>
            <td>Yes</td>
            <td>No</td>
            <td>No</td>
          </tr>
          <tr>
            <td>Aurora DSQL</td>
            <td>TCP (pg)</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>No</td>
            <td>No</td>
            <td>Yes</td>
          </tr>
        </tbody>
      </table>

      <h2>Choosing one</h2>
      <ul>
        <li>
          <strong>You target Cloudflare Workers exclusively</strong> — D1 (built-in) or Neon /
          PlanetScale / Turso over HTTP.
        </li>
        <li>
          <strong>You want Postgres on Vercel Edge</strong> — Neon, Supabase, or PlanetScale Postgres
          through the Neon serverless driver.
        </li>
        <li>
          <strong>You want MySQL with database branching</strong> — PlanetScale.
        </li>
        <li>
          <strong>You want auth + storage + realtime in one package</strong> — Supabase.
        </li>
        <li>
          <strong>You&apos;re all-in on AWS with the Lambda adapter</strong> — Aurora DSQL or RDS Postgres
          via standard <code>pg</code>.
        </li>
        <li>
          <strong>You need SQLite-style data close to users</strong> — Turso or D1.
        </li>
      </ul>

      <p>
        Once you&apos;ve picked a host, layer your query API on top: <Link href="/docs/orm/drizzle">
        Drizzle ORM
        </Link>{" "}
        works with every provider above, and <Link href="/docs/orm/prisma">Prisma</Link> works with most
        of them through Driver Adapters or standard Postgres/MySQL connectors.
      </p>
    </>
  );
}
