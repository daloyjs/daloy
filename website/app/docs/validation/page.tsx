import Link from "next/link";
import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Validation in DaloyJS",
  description:
    "DaloyJS validates requests and responses through Standard Schema. Use Zod, Valibot, ArkType, or TypeBox — pick the validator that fits your project.",
  path: "/docs/validation",
  keywords: [
    "DaloyJS validation",
    "Standard Schema",
    "request validation TypeScript",
    "Zod DaloyJS",
    "Valibot DaloyJS",
    "ArkType",
    "TypeBox",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Validation</h1>
      <p>
        DaloyJS validates inputs through{" "}
        <a href="https://github.com/standard-schema/standard-schema" target="_blank" rel="noreferrer">Standard Schema</a>
        {" "}— a tiny interface that <strong>Zod</strong>, <strong>Valibot</strong>, <strong>ArkType</strong>,
        and <strong>TypeBox</strong> all implement. Pick whichever validator fits your project; the framework
        contract is identical.
      </p>

      <h2>What gets validated</h2>
      <p>For each route you can declare schemas for:</p>
      <ul>
        <li><code>request.params</code> — path parameters (always strings; coerce in your schema if needed).</li>
        <li><code>request.query</code> — query string.</li>
        <li><code>request.headers</code> — request headers.</li>
        <li><code>request.body</code> — parsed JSON body. Only read when declared (no overhead otherwise).</li>
        <li><code>responses[status].body</code> — typed responses.</li>
      </ul>

      <h2>Pick your validator</h2>
      <ul>
        <li>
          <Link href="/docs/validation/zod">Zod</Link> — the default for most teams. Chainable API, large
          ecosystem, easy to learn.
        </li>
        <li>
          <Link href="/docs/validation/valibot">Valibot</Link> — modular and tree-shakeable. Great for edge
          runtimes and browser-shipped contracts.
        </li>
      </ul>
      <p>
        ArkType and TypeBox also work — they expose the same <code>~standard</code> property — but DaloyJS
        only ships first-party docs and scaffolds for Zod and Valibot.
      </p>

      <h2>Side-by-side</h2>
      <CodeBlock code={`// Zod
import { z } from "zod";
const Body = z.object({
  sku: z.string(),
  qty: z.number().int().positive(),
});

// Valibot
import * as v from "valibot";
const Body = v.object({
  sku: v.string(),
  qty: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

// ArkType
import { type } from "arktype";
const Body = type({ sku: "string", qty: "1<=number.integer" });

// TypeBox
import { Type } from "@sinclair/typebox";
const Body = Type.Object({ sku: Type.String(), qty: Type.Integer({ minimum: 1 }) });`} />
      <p>
        All four expose <code>~standard</code>, so DaloyJS infers handler types, generates OpenAPI, and
        returns problem+json errors the same way regardless of which one you picked.
      </p>

      <h2>Errors</h2>
      <p>
        On invalid input, DaloyJS returns <strong>422 Unprocessable Entity</strong> as RFC 9457 problem+json
        with the per-issue <code>path</code> and <code>message</code> array. You don&apos;t write an error
        handler for this — it&apos;s built in. See <Link href="/docs/errors">Errors &amp; problem+json</Link>.
      </p>

      <h2>Body limits and content types</h2>
      <p>When a route declares <code>request.body</code>, DaloyJS also enforces:</p>
      <ul>
        <li>Content-Length / streamed size against <code>app.bodyLimitBytes</code> → <strong>413</strong>.</li>
        <li>Content-Type against <code>app.allowedContentTypes</code> (default <code>application/json</code>) → <strong>415</strong>.</li>
        <li>Prototype-pollution-safe JSON parsing (<code>__proto__</code>, <code>constructor</code>, <code>prototype</code> stripped).</li>
      </ul>

      <h2>Mixing validators</h2>
      <p>
        You can mix and match per route. A Zod schema in one file and a Valibot schema in another are both
        valid — useful when migrating an existing codebase or consuming schemas from a shared package.
      </p>
    </>
  );
}
