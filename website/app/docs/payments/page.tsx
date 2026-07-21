import Link from "next/link";
import type { Route } from "next";

import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Payment & commerce integrations for DaloyJS",
  description:
    "Accept payments and integrate commerce platforms from a DaloyJS API. Provider guides cover SDK choice, webhook verification, idempotency, and runtime support.",
  path: "/docs/payments",
  keywords: [
    "DaloyJS payments",
    "Node.js payment integration",
    "Shopify DaloyJS",
    "ecommerce API Node",
    "payment webhooks",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Payment &amp; commerce integrations</h1>
      <p>
        DaloyJS treats payment providers the same way it treats{" "}
        <Link href="/docs/email">email senders</Link> and{" "}
        <Link href="/docs/orm">database clients</Link>
        {": "}wrap the provider SDK in a small{" "}
        <Link href="/docs/plugins">plugin</Link>
        {", "}attach it to <code>app.state</code>
        {", "}and call it from validated route handlers. That keeps your
        business logic provider-agnostic and makes it easy to swap or A/B
        providers later.
      </p>

      <h2 id="supported-providers">Supported providers</h2>
      <BranchDiagram
        title="One abstraction, many gateways"
        source={{
          label: "Your route handlers",
          detail: "call state.<provider>",
          eyebrow: "business logic",
        }}
        branches={[
          { label: "Stripe", detail: "stripe" },
          { label: "Shopify", detail: "shopify-api-node" },
          { label: "Braintree", detail: "braintree" },
          { label: "Authorize.Net", detail: "authorizenet" },
          { label: "Adyen", detail: "@adyen/api-library" },
          { label: "Mollie", detail: "mollie-api-typescript" },
          { label: "Tap / PayTabs", detail: "REST / paytabs_pt2" },
          { label: "Razorpay", detail: "razorpay" },
          { label: "Square", detail: "square" },
        ]}
        caption="Each provider SDK lives behind a small plugin on app.state, so your handlers stay provider-agnostic and you can swap or A/B gateways without rewriting routes."
      />
      <ul>
        <li>
          <Link href={"/docs/payments/stripe" as Route}>Stripe</Link>
          {": "}create hosted Checkout Sessions, redirect with{" "}
          <code>@stripe/stripe-js</code>
          {", "}verify <code>Stripe-Signature</code> webhooks over the raw
          body, and use idempotency keys with the official <code>stripe</code>{" "}
          Node SDK.
        </li>
        <li>
          <Link href={"/docs/payments/shopify" as Route}>Shopify</Link>
          {": "}read products, create orders, and handle Shopify webhooks via
          the community <code>shopify-api-node</code> SDK with the GraphQL Admin
          API.
        </li>
        <li>
          <Link href={"/docs/payments/braintree" as Route}>
            Braintree (PayPal)</Link>
          {": "}accept PayPal, cards, Venmo, Apple Pay, and Google Pay through
          one gateway using the official <code>braintree</code> Node SDK with
          signed webhooks.
        </li>
        <li>
          <Link href={"/docs/payments/authorize-net" as Route}>
            Authorize.Net</Link>
          {": "}charge cards, Apple Pay, and Google Pay via the official{" "}
          <code>authorizenet</code> SDK, plus HMAC-SHA512 webhook verification
          through the JSON Webhooks REST API.
        </li>
        <li>
          <Link href={"/docs/payments/adyen" as Route}>Adyen</Link>
          {": "}cards, wallets, and local payment methods via{" "}
          <code>@adyen/api-library</code> using the Sessions flow for Drop-in /
          Components and <code>hmacValidator</code> for Standard webhook
          notifications.
        </li>
        <li>
          <Link href={"/docs/payments/mollie" as Route}>Mollie</Link>
          {": "}European cards, iDEAL, Bancontact, SEPA, and Klarna via the new{" "}
          <code>mollie-api-typescript</code> SDK, with{" "}
          <code>SignatureValidator</code> for signed webhooks and async-iterable
          pagination.
        </li>
        <li>
          <Link href={"/docs/payments/tap" as Route}>Tap Payments</Link>
          {": "}GCC and MENA acquiring (KNET, Mada, Benefit, STC Pay,
          BenefitPay) via the REST Charges API with Bearer auth, hosted redirect
          flow, and <code>hashstring</code> HMAC webhook verification.
        </li>
        <li>
          <Link href={"/docs/payments/paytabs" as Route}>PayTabs</Link>
          {": "}MENA acquiring (Mada, KNET, BenefitPay, STC Pay, OmanNet,
          cards, Apple Pay) via the official
          <code>paytabs_pt2</code> npm package, wrapped as a Promise-friendly
          plugin with HMAC-SHA256 IPN signature verification.
        </li>
        <li>
          <Link href={"/docs/payments/razorpay" as Route}>Razorpay</Link>
          {": "}UPI, cards, netbanking, and wallets for India via the official{" "}
          <code>razorpay</code> Node SDK using the Orders flow,{" "}
          <code>validatePaymentVerification</code> for the client callback, and{" "}
          <code>validateWebhookSignature</code> for IPN.
        </li>
        <li>
          <Link href={"/docs/payments/square" as Route}>Square</Link>
          {": "}unified online + in-person payments via the v40+{" "}
          <code>square</code> TypeScript SDK, with BigInt money amounts, the Web
          Payments SDK token handoff, and{" "}
          <code>WebhooksHelper.verifySignature</code> over the raw body. Runs on
          Node, Vercel, Cloudflare Workers, Deno, and Bun.
        </li>
      </ul>
      <p>
        A direct PayPal Checkout guide will land here later. Each provider
        follows the same plugin shape so you can drop a new one into an existing
        application without rewriting routes.
      </p>

      <h2 id="what-every-payment-integration-needs">
        What every payment integration needs
      </h2>
      <ul>
        <li>
          <strong>Server-side secrets only.</strong> Secret keys, webhook
          signing secrets, and OAuth access tokens belong in environment
          variables, never in the browser bundle or in a Next.js client
          component.
        </li>
        <li>
          <strong>Webhook signature verification.</strong> Every provider signs
          its webhooks. Verify the signature on the raw request body{" "}
          <em>before</em> doing anything with the payload, DaloyJS exposes the
          unparsed body so HMAC checks work correctly.
        </li>
        <li>
          <strong>Idempotency.</strong> Networks retry. Store the
          provider&apos;s event ID (or send an idempotency key on outbound
          requests) so duplicate deliveries don&apos;t double-charge or
          double-fulfill.
        </li>
        <li>
          <strong>Rate limits.</strong> Most commerce APIs throttle
          aggressively. Wrap the provider client so retries and back-off live in
          one place, and lean on the built-in{" "}
          <Link href="/docs/security">rateLimit middleware</Link> for your own
          endpoints.
        </li>
        <li>
          <strong>Error mapping.</strong> Surface provider failures through{" "}
          <Link href="/docs/errors">problem+json</Link> so clients (and{" "}
          <Link href="/docs/typed-client">typed clients</Link>) see a consistent
          error shape.
        </li>
      </ul>

      <h2 id="common-plugin-shape">Common plugin shape</h2>
      <FlowDiagram
        title="Plugin lifecycle"
        numbered
        steps={[
          {
            label: "Wrap the SDK",
            detail: "new ProviderSDK(secrets)",
            eyebrow: "plugin",
          },
          {
            label: "Attach to state",
            detail: "app.decorate(name, client)",
            eyebrow: "register",
          },
          {
            label: "Call from handlers",
            detail: "state.<provider>.charge()",
            eyebrow: "routes",
            tone: "accent",
          },
          {
            label: "Verify webhooks",
            detail: "HMAC over raw body",
            eyebrow: "callbacks",
            tone: "success",
          },
        ]}
        caption="Every provider guide follows the same four steps, so dropping a new gateway into an existing app never touches your route code."
      />
      <p>
        Each provider guide implements roughly the same interface on{" "}
        <code>app.state</code>
        {": "}
      </p>
      <CodeBlock
        code={`// src/plugins/commerce.ts
import type { App } from "@daloyjs/core";

export interface CommerceClient {
  // Read a product / order / customer.
  read(kind: string, id: string): Promise<unknown>;
  // Verify and parse a webhook from the provider.
  verifyWebhook(headers: Headers, rawBody: Buffer): Promise<{ topic: string; payload: unknown }>;
}

declare module "@daloyjs/core" {
  interface AppState {
    commerce: CommerceClient;
  }
}`}
      />
      <p>
        Provider pages keep the shape but specialise the method names where it
        makes the SDK nicer to read (for example, Shopify gets a{" "}
        <code>graphql()</code> passthrough so you can run typed GraphQL queries
        without leaving the plugin).
      </p>
    </>
  );
}
