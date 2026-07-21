import Link from "next/link";
import type { Route } from "next";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Integrate Shopify with DaloyJS",
  description:
    "Call the Shopify Admin GraphQL API and verify Shopify webhooks from a DaloyJS API using the community shopify-api-node SDK. Covers custom-app access tokens, API versioning, rate limits, pagination, and HMAC verification.",
  path: "/docs/payments/shopify",
  keywords: [
    "DaloyJS Shopify",
    "shopify-api-node",
    "Shopify Admin GraphQL DaloyJS",
    "Shopify webhook verification Node",
    "Shopify custom app access token",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Integrate Shopify with DaloyJS</h1>
      <p>
        <a href="https://www.shopify.com/" target="_blank" rel="noreferrer">
          Shopify
        </a>{" "}
        is the commerce platform behind millions of stores. This guide uses the
        community{" "}
        <a
          href="https://github.com/MONEI/Shopify-api-node"
          target="_blank"
          rel="noreferrer"
        >
          <code>shopify-api-node</code>
        </a>{" "}
        SDK (maintained by MONEI) to call the Shopify Admin API from a DaloyJS
        plugin, and shows how to verify Shopify webhooks against the raw request
        body.
      </p>

      <h2 id="rest-is-deprecated-prefer-graphql">
        REST is deprecated: prefer GraphQL
      </h2>
      <p>
        Shopify{" "}
        <a
          href="https://shopify.dev/docs/api/admin-rest"
          target="_blank"
          rel="noreferrer"
        >
          froze the REST Admin API at version 2024-04
        </a>{" "}
        and requires new public apps to use the{" "}
        <a
          href="https://shopify.dev/docs/api/admin-graphql"
          target="_blank"
          rel="noreferrer"
        >
          GraphQL Admin API</a>
        {". "}The REST resources on <code>shopify-api-node</code> (<code>shopify.product.list</code>
        {", "}<code>shopify.order.create</code>
        {", "}
        &hellip;) still work against older API versions, but you should write
        new code against the SDK&apos;s <code>shopify.graphql()</code> method.
        Every example below uses GraphQL.
      </p>
      <p>
        Pin your <code>apiVersion</code> to a current stable release (Shopify
        ships a new version every quarter, supports each for 12 months, and
        lists them on the{" "}
        <a
          href="https://shopify.dev/docs/api/usage/versioning"
          target="_blank"
          rel="noreferrer"
        >
          versioning page</a>). The default in <code>shopify-api-node</code> is the <em>oldest</em>{" "}
        supported stable version, which is usually not what you want.
      </p>

      <h2 id="1-provision-a-custom-app">1. Provision a custom app</h2>
      <ol>
        <li>
          In the Shopify admin, open{" "}
          <strong>Settings → Apps and sales channels → Develop apps</strong>
          {", "}
          then create a custom app. The legacy &ldquo;private apps&rdquo; flow
          (API key + password) was removed back in January 2022, don&apos;t use
          the <code>apiKey</code> / <code>password</code> options on the SDK.
        </li>
        <li>
          Pick the{" "}
          <a
            href="https://shopify.dev/docs/api/usage/access-scopes"
            target="_blank"
            rel="noreferrer"
          >
            Admin API access scopes
          </a>{" "}
          your integration actually needs (for example{" "}
          <code>read_products</code>
          {", "}<code>write_orders</code>). Stay minimal, you can always grant
          more later.
        </li>
        <li>
          Install the app on the store. Copy the{" "}
          <strong>Admin API access token</strong> (starts with{" "}
          <code>shpat_</code>). This is the only credential the SDK needs.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add shopify-api-node`} />
      <p>
        TypeScript users: the package ships its own typings (under{" "}
        <code>types/</code> in the repo). No{" "}
        <code>@types/shopify-api-node</code> install needed.
      </p>

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
SHOPIFY_SHOP=acme-test.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2026-01
SHOPIFY_WEBHOOK_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
      />
      <p>
        The webhook secret is shown when you create a webhook subscription
        (either in the admin or via GraphQL{" "}
        <code>webhookSubscriptionCreate</code>). Update{" "}
        <code>SHOPIFY_API_VERSION</code> to the latest stable on each Shopify
        release.
      </p>

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/shopify.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import Shopify from "shopify-api-node";
import type { App } from "@daloyjs/core";

const shopify = new Shopify({
  shopName: process.env.SHOPIFY_SHOP!,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN!,
  apiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-01",
  // Retry 429s and respect Shopify's GraphQL throttled-cost data.
  // Mutually exclusive with autoLimit - pick one.
  maxRetries: 5,
  timeout: 30_000,
});

// Optional: surface throttle pressure to your metrics layer.
shopify.on("callGraphqlLimits", (limits) => {
  // { actualQueryCost, requestedQueryCost, throttleStatus: { ... } }
  if (limits.throttleStatus.currentlyAvailable < 100) {
    console.warn("[shopify] graphql credits low", limits.throttleStatus);
  }
});

function verifyShopifyHmac(rawBody: Buffer, headerHmac: string | null) {
  if (!headerHmac) return false;
  const digest = createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(headerHmac, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ShopifyClient {
  graphql<TData = unknown, TVars extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    variables?: TVars,
  ): Promise<TData>;
  verifyWebhook(headers: Headers, rawBody: Buffer): {
    ok: boolean;
    topic: string | null;
    shop: string | null;
    eventId: string | null;
  };
}

export const shopifyPlugin = {
  name: "shopify",
  register(app: App) {
    const client: ShopifyClient = {
      graphql: (query, variables) => shopify.graphql(query, variables) as Promise<never>,
      verifyWebhook(headers, rawBody) {
        return {
          ok: verifyShopifyHmac(rawBody, headers.get("x-shopify-hmac-sha256")),
          topic: headers.get("x-shopify-topic"),
          shop: headers.get("x-shopify-shop-domain"),
          eventId: headers.get("x-shopify-webhook-id"),
        };
      },
    };
    app.decorate("shopify", client);
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    shopify: ShopifyClient;
  }
}`}
      />

      <h2 id="5-query-products-with-graphql">5. Query products with GraphQL</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders } from "@daloyjs/core";
import { shopifyPlugin } from "./plugins/shopify.ts";

const app = new App();
app.use(secureHeaders());
app.register(shopifyPlugin);

const ProductsQuery = /* GraphQL */ \`
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          status
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
        }
      }
    }
  }
\`;

app.get(
  "/catalog/products",
  {
    operationId: "listShopifyProducts",
    request: {
      query: z.object({
        first: z.coerce.number().int().min(1).max(50).default(20),
        after: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Page of products",
        body: z.object({
          products: z.array(z.object({
            id: z.string(),
            title: z.string(),
            handle: z.string(),
            status: z.string(),
            price: z.object({ amount: z.string(), currency: z.string() }),
          })),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  },
  async ({ query, state }) => {
    const data = await state.shopify.graphql<{
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: Array<{ node: {
          id: string; title: string; handle: string; status: string;
          priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
        } }>;
      };
    }>(ProductsQuery, { first: query.first, after: query.after ?? null });

    return {
      status: 200,
      body: {
        products: data.products.edges.map((e) => ({
          id: e.node.id,
          title: e.node.title,
          handle: e.node.handle,
          status: e.node.status,
          price: {
            amount: e.node.priceRangeV2.minVariantPrice.amount,
            currency: e.node.priceRangeV2.minVariantPrice.currencyCode,
          },
        })),
        nextCursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null,
      },
    };
  },
);`}
      />
      <p>
        GraphQL pagination uses opaque cursors (<code>endCursor</code>) rather
        than the REST
        <code>nextPageParameters</code> helper. Forward the cursor as a query
        string to your client.
      </p>

      <h2 id="6-receive-and-verify-webhooks">6. Receive and verify webhooks</h2>
      <SequenceDiagram
        title="Webhook verification"
        participants={["Shopify", "DaloyJS route", "Your worker"]}
        steps={[
          {
            from: "Shopify",
            to: "DaloyJS route",
            label: "POST /webhooks/shopify",
            detail: "X-Shopify-Hmac-Sha256 over raw body",
            kind: "request",
          },
          {
            from: "DaloyJS route",
            to: "DaloyJS route",
            label: "Compare HMAC-SHA256 with timingSafeEqual",
            detail: "verifyWebhook(headers, rawBody)",
            kind: "note",
          },
          {
            from: "DaloyJS route",
            to: "Shopify",
            label: "401 when the signature does not match",
            detail: "{ error: 'invalid signature' }",
            kind: "response",
          },
          {
            from: "DaloyJS route",
            to: "Your worker",
            label: "Dedupe on X-Shopify-Webhook-Id, then enqueue",
            detail: "ack 200 within ~5s",
            kind: "async",
          },
        ]}
        caption="Hash the raw bytes before JSON.parse, reject bad signatures with 401, dedupe on the webhook id, then ack fast and do the heavy work in a background job."
      />
      <p>
        Shopify signs every webhook with <code>X-Shopify-Hmac-Sha256</code> over
        the <em>raw</em> body. Skip JSON parsing until the signature matches,
        and dedupe on <code>X-Shopify-Webhook-Id</code> so retries don&apos;t
        double-process. Use the{" "}
        <Link href="/docs/api-reference/security">bounded raw-body helper</Link>{" "}
        to get the bytes:
      </p>
      <CodeBlock
        code={`import { z } from "zod";
import { readBodyLimited } from "@daloyjs/core";

app.post(
  "/webhooks/shopify",
  {
    operationId: "shopifyWebhook",
    // No body schema - we hash bytes before parsing.
    responses: {
      200: { description: "ack", body: z.object({ ok: z.literal(true) }) },
      401: { description: "bad signature", body: z.object({ error: z.string() }) },
    },
  },
  async ({ request, state }) => {
    // Keep webhook reads bounded and preserve the exact bytes Shopify signed.
    const raw = Buffer.from(await readBodyLimited(request, 1_048_576));
    const result = state.shopify.verifyWebhook(request.headers, raw);
    if (!result.ok) {
      return { status: 401, body: { error: "invalid signature" } };
    }
    // Dedupe before any side effect.
    if (result.eventId && (await seen(result.eventId))) {
      return { status: 200, body: { ok: true as const } };
    }

    const payload = JSON.parse(raw.toString("utf8"));
    switch (result.topic) {
      case "orders/create":
        await onOrderCreated(payload);
        break;
      case "orders/paid":
        await onOrderPaid(payload);
        break;
      case "app/uninstalled":
        await onAppUninstalled(result.shop, payload);
        break;
      // ...
    }

    return { status: 200, body: { ok: true as const } };
  },
);`}
      />
      <p>
        Shopify expects a 2xx within ~5 seconds, retries with exponential
        back-off for up to 48 hours, and disables the subscription after 19
        consecutive failures. Do the heavy work in a background job and ack
        fast.
      </p>

      <h2 id="rate-limits">Rate limits</h2>
      <p>
        The GraphQL Admin API uses a{" "}
        <a
          href="https://shopify.dev/docs/api/usage/rate-limits"
          target="_blank"
          rel="noreferrer"
        >
          calculated cost &amp; leaky-bucket model</a>
        {". "}Use the <code>maxRetries</code> option (above) so the SDK respects
        the throttled-cost information that comes back on 429 responses.{" "}
        <code>autoLimit</code> only works for the REST API and only inside a
        single Node process, skip it for GraphQL or multi-instance deployments
        and rely on retries instead.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        <code>shopify-api-node</code> is built on{" "}
        <a
          href="https://github.com/sindresorhus/got"
          target="_blank"
          rel="noreferrer"
        >
          got v11</a>
        {", "}which depends on Node&apos;s HTTPS module. It runs fine on Node,
        Bun, AWS Lambda, and any long-running container, but it is{" "}
        <strong>not</strong> drop-in compatible with{" "}
        <Link href="/docs/adapters">Cloudflare Workers</Link>
        {". "}On those runtimes, call the Admin GraphQL endpoint directly with{" "}
        <code>fetch</code>
        {": "}
      </p>
      <CodeBlock
        code={`// edge-friendly fallback
const res = await fetch(
  \`https://\${shop}/admin/api/\${apiVersion}/graphql.json\`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  },
);`}
      />

      <h2 id="alternatives">Alternatives</h2>
      <p>
        Shopify also publishes the official{" "}
        <a
          href="https://github.com/Shopify/shopify-api-js"
          target="_blank"
          rel="noreferrer"
        >
          <code>@shopify/shopify-api</code>
        </a>{" "}
        library, which adds OAuth for public/embedded apps and a built-in
        webhook registry. Reach for it when you&apos;re building a Shopify App
        Store listing; reach for <code>shopify-api-node</code> when you&apos;re
        building a server-side integration for a single store and want a smaller
        surface.
      </p>

      <p>
        See also the{" "}
        <Link href={"/docs/payments" as Route}>payments overview</Link>
        {", "}
        <Link href="/docs/errors">problem+json errors</Link>
        {", "}and{" "}
        <Link href="/docs/security/rate-limit-redis">
          distributed rate-limit store</Link>
        {"."}
      </p>
    </>
  );
}
