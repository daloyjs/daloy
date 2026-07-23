import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "openapi-3-1-extras-webhooks-callbacks-discriminators",
  title: "OpenAPI 3.1 Extras: Webhooks, Callbacks, and Discriminators",
  description:
    "A practical tour of the OpenAPI 3.1 features your generated clients are still waiting for: top-level webhooks for event-driven APIs, route-level callbacks for payment-style async flows, and the discriminator()/discriminatedUnion() pair that turns polymorphic payloads into tagged TypeScript unions you can switch on with confidence.",
  date: "2026-05-31",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently writing TypeScript from a desk in Norway. Survivor of two webhook-signing migrations and one schema rewrite that should have used a discriminator from day one.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "OpenAPI 3.1 webhooks",
    "OpenAPI callbacks",
    "discriminator object",
    "discriminatedUnion",
    "payment API",
    "event-driven API",
    "polymorphic schema",
    "tagged union typescript",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const THE_PROBLEM = `# A representative API contract circa "we'll figure it out later":
#
# - "The PDF documents the /webhooks/billing request body. We announce
#    version changes manually. Ask support for the X-Signature algorithm."
#
# - "Booking events have 12 type values with unrelated payloads. The
#    TypeScript surface exposes data: Record<string, unknown>."
#
# - "Provide a callback URL when creating a payment. The callback body
#    is undocumented and the generated SDK omits it."
#
# Each omission becomes somebody else's integration bug.`;

const WEBHOOKS_TOP_LEVEL = `// src/index.ts, top-level webhooks describe events YOU send to consumers.
// They never become a route on your server. They show up in the OpenAPI
// document and in every generated client SDK.
import { App, generateOpenAPI } from "@daloyjs/core";
import { z } from "zod";

const app = new App({
  openapi: {
    info: { title: "Bookstore API", version: "1.0.0" },
    webhooks: {
      // The webhook name is what every client SDK exposes.
      "invoice.paid": {
        method: "POST",
        operationId: "invoicePaidWebhook",
        summary: "Sent when an invoice transitions to PAID.",
        tags: ["Webhooks", "Billing"],
        request: {
          headers: z.object({
            "x-signature": z.string().describe("HMAC-SHA256 of body, hex"),
            "x-event-id": z.uuid(),
          }),
          body: z.object({
            type: z.literal("invoice.paid"),
            data: z.object({
              invoiceId: z.uuid(),
              amountCents: z.number().int().positive(),
              currency: z.enum(["EUR", "NOK", "USD"]),
              paidAt: z.iso.datetime(),
            }),
          }),
        },
        responses: {
          200: {
            description: "Consumer acknowledged the event.",
            body: z.object({ received: z.literal(true) }),
          },
          410: {
            description: "Consumer endpoint no longer exists - we stop retrying.",
          },
        },
      },
    },
  },
});`;

const WEBHOOK_CLIENT_USAGE = `// On the CONSUMER's side, the generated SDK contains a typed adapter:
//
//   import { handleInvoicePaidWebhook } from "@yourapi/client";
//
//   export async function POST(req: Request) {
//     const { signature, event, error } = await handleInvoicePaidWebhook(req, {
//       secret: process.env.INVOICE_WEBHOOK_SECRET!,
//     });
//     if (error) return error.toResponse();         // <- typed problem+json
//     // event is fully typed: event.data.amountCents is \`number\`, not \`unknown\`.
//     await db.invoices.update(event.data.invoiceId, { status: "paid" });
//     return new Response(JSON.stringify({ received: true }));
//   }
//
// The webhook section appears in /openapi.json under the top-level
// "webhooks" key (OpenAPI 3.1 feature; not available in 3.0). Scalar
// renders it in your /docs UI alongside paths and components.`;

const CALLBACK_PAYMENT = `// src/routes/payments.ts, callbacks describe out-of-band requests YOUR
// API will make back to the consumer. The canonical example: create a
// payment, get notified later when it settles.
import { z } from "zod";
import type { CallbackMap } from "@daloyjs/core";

const PaymentCreate = z.object({
  amountCents: z.number().int().positive(),
  currency: z.enum(["EUR", "NOK", "USD"]),
  callbackUrl: z.url(),            // <- the URL we'll POST to later
});

const paymentCallbacks: CallbackMap = {
  // Callback name - appears in the generated client SDK.
  paymentSettled: {
    // Runtime expression - the spec value. Tells consumers WHERE we'll POST.
    "{$request.body#/callbackUrl}": {
      method: "POST",
      operationId: "paymentSettledCallback",
      summary: "We POST this when the payment leaves PENDING.",
      request: {
        headers: z.object({
          "x-signature": z.string(),
        }),
        body: z.object({
          paymentId: z.uuid(),
          status: z.enum(["captured", "failed"]),
          failureReason: z.string().optional(),
        }),
      },
      responses: {
        200: { description: "Consumer acknowledged." },
        4: { description: "We retry 4xx up to 5 times with backoff." },
      },
    },
  },
};

app.route({
  method: "POST",
  path: "/payments",
  operationId: "createPayment",
  request: { body: PaymentCreate },
  responses: {
    202: {
      description: "Accepted - payment is pending. Watch for the callback.",
      body: z.object({ paymentId: z.uuid() }),
    },
  },
  callbacks: paymentCallbacks,     // <- attaches to THIS operation only
  handler: createPaymentHandler,
});`;

const CALLBACK_WHY = `// Why bother spelling this out in the spec?
//
// 1. The runtime expression "{$request.body#/callbackUrl}" tells the spec
//    consumer EXACTLY which field of the request body becomes the URL.
//    Generated clients can build mock servers around it. Postman renders it.
//
// 2. The request/response bodies attached to the callback are validated
//    types in the generated SDK. The consumer's endpoint receives
//    "PaymentSettledCallbackBody" - never "unknown" - and gets to use the
//    framework's response helpers for the 200 ack.
//
// 3. Contract tests on the consumer side can pin the EXACT shape they'll
//    accept: \`expectContract<PaymentSettledCallbackBody>(req.body)\`. If you
//    bump the API minor version and forget to update the callback, CI fails.
//
// 4. Documentation. Your Scalar UI shows the callback as a sub-operation of
//    POST /payments, with its own example payload and response. Onboarding
//    docs basically write themselves.`;

const DISCRIMINATOR_SIMPLE = `// src/schemas/animal.ts, the bare discriminator() helper.
// Use when you already have a hand-rolled JSON schema and want to attach
// the OpenAPI discriminator object cleanly:
import { discriminator } from "@daloyjs/core";

export const Animal = {
  oneOf: [
    { $ref: "#/components/schemas/Cat" },
    { $ref: "#/components/schemas/Dog" },
    { $ref: "#/components/schemas/Owl" },
  ],
  discriminator: discriminator("kind", {
    cat: "#/components/schemas/Cat",
    dog: "#/components/schemas/Dog",
    owl: "#/components/schemas/Owl",
  }),
};`;

const DISCRIMINATED_UNION = `// src/schemas/booking-event.ts, the everyday case: runtime validator +
// OpenAPI emitter in one. Drop-in for any route's request or response body.
import { z } from "zod";
import { discriminatedUnion } from "@daloyjs/core";

const BookingCreated = z.object({
  type: z.literal("booking.created"),
  bookingId: z.uuid(),
  customerId: z.uuid(),
  totalCents: z.number().int().positive(),
});

const BookingCancelled = z.object({
  type: z.literal("booking.cancelled"),
  bookingId: z.uuid(),
  reason: z.enum(["user_requested", "payment_failed", "fraud"]),
  refundCents: z.number().int().nonnegative(),
});

const BookingShipped = z.object({
  type: z.literal("booking.shipped"),
  bookingId: z.uuid(),
  carrier: z.enum(["posten", "bring", "dhl"]),
  trackingNumber: z.string(),
});

// One union. Three variants. Runtime validation + JSON Schema in one call:
export const BookingEvent = discriminatedUnion("type", {
  "booking.created":   BookingCreated,
  "booking.cancelled": BookingCancelled,
  "booking.shipped":   BookingShipped,
});

// Use it like any other schema:
app.route({
  method: "POST",
  path: "/events/booking",
  operationId: "ingestBookingEvent",
  request: { body: BookingEvent },
  responses: { 202: { description: "Accepted" } },
  handler: async ({ body }) => {
    // \`body\` is a discriminated union. TypeScript narrows on \`body.type\`.
    switch (body.type) {
      case "booking.created":   return create(body);    // <- totalCents is in scope
      case "booking.cancelled": return cancel(body);    // <- refundCents in scope
      case "booking.shipped":   return ship(body);      // <- trackingNumber in scope
    }
  },
});`;

const JSON_SCHEMA_OUTPUT = `// What \`BookingEvent\` emits into your OpenAPI spec, the part the generated
// client SDK reads to produce a real TypeScript tagged union:
{
  "oneOf": [
    { "$ref": "#/components/schemas/BookingCreated" },
    { "$ref": "#/components/schemas/BookingCancelled" },
    { "$ref": "#/components/schemas/BookingShipped" }
  ],
  "discriminator": {
    "propertyName": "type",
    "mapping": {
      "booking.created":   "#/components/schemas/BookingCreated",
      "booking.cancelled": "#/components/schemas/BookingCancelled",
      "booking.shipped":   "#/components/schemas/BookingShipped"
    }
  }
}`;

const CONSUMER_TAGGED_UNION = `// generated/client/types.gen.ts (output, not hand-written)
export type BookingEvent =
  | { type: "booking.created";   bookingId: string; customerId: string; totalCents: number }
  | { type: "booking.cancelled"; bookingId: string; reason: "user_requested" | "payment_failed" | "fraud"; refundCents: number }
  | { type: "booking.shipped";   bookingId: string; carrier: "posten" | "bring" | "dhl"; trackingNumber: string };

// apps/web/components/event-feed.tsx - react consumer.
function EventRow({ event }: { event: BookingEvent }) {
  switch (event.type) {
    case "booking.created":
      // event is narrowed: totalCents exists, refundCents does NOT.
      return <span>New booking {event.bookingId} · {event.totalCents / 100} EUR</span>;
    case "booking.cancelled":
      return <span>Cancelled {event.bookingId} · refund {event.refundCents / 100} EUR ({event.reason})</span>;
    case "booking.shipped":
      return <span>Shipped {event.bookingId} via {event.carrier} · {event.trackingNumber}</span>;
  }
}
// Add a new variant in the SERVER schema, run \`pnpm gen\` on the CLIENT side,
// and the TypeScript compiler instantly flags every \`switch\` that doesn't
// handle it. That's the entire point.`;

const WEBHOOK_DISCRIM_COMBO = `// The pattern: ONE webhook entry whose body is a discriminated union over
// every event type. The generated client gets one typed handler with
// exhaustive switch coverage instead of N near-identical webhook adapters.
const app = new App({
  openapi: {
    info: { title: "Bookstore API", version: "1.0.0" },
    webhooks: {
      "booking.event": {
        method: "POST",
        operationId: "bookingEventWebhook",
        summary: "Fires for every booking lifecycle transition.",
        request: {
          headers: z.object({ "x-signature": z.string() }),
          body: BookingEvent,                 // <- the discriminatedUnion above
        },
        responses: {
          200: { description: "Acknowledged" },
        },
      },
    },
  },
});

// Consumer (Next.js route handler):
export async function POST(req: Request) {
  const { event, error } = await handleBookingEventWebhook(req, {
    secret: process.env.BOOKING_WEBHOOK_SECRET!,
  });
  if (error) return error.toResponse();
  switch (event.type) {                       // <- exhaustive, type-checked
    case "booking.created":   return ingestCreated(event);
    case "booking.cancelled": return ingestCancelled(event);
    case "booking.shipped":   return ingestShipped(event);
  }
}`;

const GEN_FLOW = `# The end-to-end loop you actually run:
pnpm gen:openapi            # dumps your spec to generated/openapi.json
pnpm gen                    # Hey API codegen -> generated/client/

# What ends up on disk:
generated/
├─ openapi.json             # the OpenAPI 3.1 doc (with paths, webhooks, components)
└─ client/
   ├─ types.gen.ts          # tagged unions for every discriminatedUnion()
   ├─ sdk.gen.ts            # typed functions for routes + webhooks + callbacks
   └─ client.gen.ts         # the fetch wrapper

# CI gate: spec drift = test failure.
pnpm gen:openapi
git diff --exit-code generated/openapi.json
# ─-> exits 1 if the committed spec doesn't match the live route registry.`;

const SUMMARY_TABLE = `# When to reach for which feature.

webhooks (top-level)      -> Events YOU emit to consumers. They never become
                            a route on your server. Always pair with
                            x-signature headers and a discriminated union
                            body if you have more than one event type.

callbacks (route-level)   -> Out-of-band requests YOUR API will make back to
                            the consumer that triggered an operation.
                            Canonical: payments, long-running jobs, OAuth.
                            The runtime expression points at the request
                            field that supplied the URL.

discriminator()           -> Bare OpenAPI 3.1 spec builder. Use when you
                            already have hand-rolled JSON schemas and just
                            want the discriminator block.

discriminatedUnion()      -> Runtime validator + OpenAPI emitter, in one.
                            Default choice for polymorphic request/response
                            bodies. Produces exhaustive TypeScript tagged
                            unions on the client side.`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: POST.title,
  description: POST.description,
  datePublished: POST.date,
  dateModified: POST.date,
  author: { "@type": "Person", name: POST.author },
  publisher: { "@type": "Organization", name: "DaloyJS", url: SITE_URL },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/blog/${POST.slug}`,
  },
  url: `${SITE_URL}/blog/${POST.slug}`,
};

function EditorFrame({
  files,
  activeFile,
  status,
  children,
  className,
}: {
  files: readonly string[];
  activeFile: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" aria-hidden />
          <span
            className="size-2.5 rounded-full bg-yellow-400/80"
            aria-hidden
          />
          <span className="size-2.5 rounded-full bg-green-400/80" aria-hidden />
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {files.map((file) => {
            const isActive = file === activeFile;
            return (
              <span
                key={file}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] sm:text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground"
                )}
              >
                {file}
              </span>
            );
          })}
        </div>
      </div>
      <div className="bg-background">{children}</div>
      {status ? (
        <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase sm:text-[11px]">
          <span className="truncate">{status}</span>
          <span aria-hidden>TS · UTF-8 · LF</span>
        </div>
      ) : null}
    </div>
  );
}

function FeatureCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {badge}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">OpenAPI</Badge>
            <Badge variant="outline">Contract design</Badge>
            <Badge variant="outline">Typed clients</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {POST.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            {POST.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{POST.author}</span>
            <span aria-hidden>·</span>
            <span>{POST.authorRole}</span>
            <span aria-hidden>·</span>
            <time dateTime={POST.date}>
              {dateFormatter.format(new Date(POST.date))}
            </time>
            <span aria-hidden>·</span>
            <span>{POST.readingTime}</span>
          </div>
        </header>

        <Separator className="mb-10" />

        <div className="docs-prose max-w-full">
          <p>
            Hi, Devlin. Ten years of fullstack, currently in Norway, and I have
            just enough scars from integrating payment APIs to have opinions
            about the bits of OpenAPI 3.1 that nobody talks about. This post is
            for the &quot;our contract is serious now &quot; phase: the moment
            you stop describing endpoints with a wiki page and start asking{" "}
            <em>what does my generated client actually need from this spec?</em>
          </p>

          <p>
            Three features carry most of the weight, and DaloyJS exposes all
            three as first-class building blocks:{" "}
            <strong>top-level webhooks</strong> for events you emit,{" "}
            <strong>route-level callbacks</strong> for out-of-band calls you
            make back to the consumer, and the{" "}
            <strong>discriminator + discriminatedUnion pair</strong> that turns
            polymorphic payloads into tagged TypeScript unions a
            <code>switch</code> statement actually understands.
          </p>

          <h2>The pain you&apos;re here to fix</h2>

          <EditorFrame
            files={["status-quo.txt"]}
            activeFile="status-quo.txt"
            status="three classic gaps · all fixable in 3.1"
          >
            <CodeBlock language="bash" code={THE_PROBLEM} />
          </EditorFrame>

          <h2>Webhooks: the events YOU send</h2>

          <p>
            OpenAPI 3.0 had no native concept of &quot;the things this API posts
            to you&quot;. People worked around it by inventing companion specs,
            prose docs, or, most often, nothing at all. OpenAPI 3.1 added a
            top-level <code>webhooks</code> map, which is the spec saying{" "}
            <em>
              here are the requests this API will send, and here is their exact
              shape
            </em>
            {". "}DaloyJS lets you declare them next to your routes:
          </p>

          <EditorFrame
            files={["src/index.ts"]}
            activeFile="src/index.ts"
            status="OpenAPI 3.1 top-level webhooks · never become routes"
          >
            <CodeBlock language="ts" code={WEBHOOKS_TOP_LEVEL} />
          </EditorFrame>

          <p>
            The webhook is never bound to a path on <em>your</em> server,
            it&apos;s a contract for consumers. What changes is what falls out
            of <code>pnpm gen</code> on the consumer&apos;s side:
          </p>

          <EditorFrame
            files={["apps/consumer/app/webhooks/billing/route.ts"]}
            activeFile="apps/consumer/app/webhooks/billing/route.ts"
            status="typed receiver · signature verification · zero unknowns"
          >
            <CodeBlock language="ts" code={WEBHOOK_CLIENT_USAGE} />
          </EditorFrame>

          <FeatureCard badge="3.1 only" title="Top-level webhooks">
            Not present in 3.0. Make sure your spec consumers (Postman, Scalar,
            Hey API, Speakeasy, the lot) target 3.1. Scalar renders them in the{" "}
            <code>/docs</code> UI alongside paths and components automatically.
          </FeatureCard>

          <h2>Callbacks: the events YOU make in response to a request</h2>

          <p>
            Webhooks are subscriptions, you set them up out-of-band and they
            fire whenever an event happens. Callbacks are different: they are
            out-of-band requests <em>tied to a specific operation</em>
            {". "}The canonical example is payments. The consumer creates a
            payment with a <code>callbackUrl</code>; you POST to that URL when
            the payment settles.
          </p>

          <p>
            The OpenAPI <em>runtime expression</em>{" "}
            <code>{"{$request.body#/callbackUrl}"}</code> tells the spec
            consumer <em>where the callback URL comes from</em>
            {": "}which field of which message. That&apos;s the difference
            between a tool being able to generate a mock callback server and a
            sentence in a README saying &quot;put the URL in callbackUrl&quot;.
          </p>

          <EditorFrame
            files={["src/routes/payments.ts"]}
            activeFile="src/routes/payments.ts"
            status="callback attached to ONE operation · runtime expression points at request body"
          >
            <CodeBlock language="ts" code={CALLBACK_PAYMENT} />
          </EditorFrame>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="four reasons the spec gives you back the time you spent writing it"
          >
            <CodeBlock language="bash" code={CALLBACK_WHY} />
          </EditorFrame>

          <h2>Discriminators: the bare spec builder</h2>

          <p>
            When you have hand-rolled JSON schemas already (legacy spec
            migration, third-party schema files you compose with), the{" "}
            <code>discriminator()</code> helper is the small, type-checked spec
            object you want. It validates the property name at boot, so an empty
            string never silently lands in your spec:
          </p>

          <EditorFrame
            files={["src/schemas/animal.ts"]}
            activeFile="src/schemas/animal.ts"
            status="bare OpenAPI 3.1 discriminator object · throws on empty propertyName"
          >
            <CodeBlock language="ts" code={DISCRIMINATOR_SIMPLE} />
          </EditorFrame>

          <h2>discriminatedUnion(): the one you&apos;ll actually use</h2>

          <p>
            <code>discriminatedUnion()</code> is the daily-driver helper.
            It&apos;s a Standard Schema, so it validates request and response
            bodies at runtime; it also exposes a <code>.toJSONSchema()</code>{" "}
            projection so the OpenAPI generator picks up the <code>oneOf</code>{" "}
            + <code>discriminator</code> pair without any glue. One declaration;
            both jobs done:
          </p>

          <EditorFrame
            files={["src/schemas/booking-event.ts"]}
            activeFile="src/schemas/booking-event.ts"
            status="runtime validator + OpenAPI emitter · TypeScript narrows on body.type"
          >
            <CodeBlock language="ts" code={DISCRIMINATED_UNION} />
          </EditorFrame>

          <p>
            What lands in the spec is the boring, standards-compliant shape
            every code generator understands:
          </p>

          <EditorFrame
            files={[
              "generated/openapi.json · #/components/schemas/BookingEvent",
            ]}
            activeFile="generated/openapi.json · #/components/schemas/BookingEvent"
            status="oneOf + discriminator.mapping · the canonical 3.1 polymorphic shape"
          >
            <CodeBlock language="json" code={JSON_SCHEMA_OUTPUT} />
          </EditorFrame>

          <p>
            And the client SDK, the one Hey API generates for you, picks it up
            as a real tagged union, with <em>exhaustive switch</em> protection
            on the consumer side. This is the bit your future self will thank
            you for:
          </p>

          <EditorFrame
            files={["generated/client/types.gen.ts"]}
            activeFile="generated/client/types.gen.ts"
            status="tagged union · narrowed inside switch · new variant = type error"
          >
            <CodeBlock language="ts" code={CONSUMER_TAGGED_UNION} />
          </EditorFrame>

          <h2>The combo: webhooks + discriminatedUnion</h2>

          <p>
            I keep recommending this pattern in design reviews:
            <em>one</em> webhook entry whose body is a discriminated union over
            every event type. The alternative, one webhook per event type,
            produces an SDK with N near-identical handlers, N opportunities to
            forget signature verification, and N opportunities to disagree with
            yourself about retry semantics. The combo collapses all of that to
            one typed handler with one exhaustive switch:
          </p>

          <EditorFrame
            files={["src/index.ts + apps/consumer/route.ts"]}
            activeFile="src/index.ts + apps/consumer/route.ts"
            status="one webhook · union body · one consumer handler · exhaustive switch"
          >
            <CodeBlock language="ts" code={WEBHOOK_DISCRIM_COMBO} />
          </EditorFrame>

          <h2>The codegen loop and the CI gate</h2>

          <p>
            None of this matters if the spec drifts from the live route table.
            The discipline is the same as for plain routes: dump the spec from{" "}
            <code>buildApp()</code> in a script, regenerate the client, and gate
            CI on <code>git diff --exit-code</code> against the committed spec.
            Adding a webhook changes the spec, fails the diff, and forces the PR
            to regenerate the client before merge.
          </p>

          <EditorFrame
            files={["terminal · zsh"]}
            activeFile="terminal · zsh"
            status="pnpm gen:openapi · pnpm gen · git diff --exit-code in CI"
          >
            <CodeBlock language="bash" code={GEN_FLOW} />
          </EditorFrame>

          <h2>When to reach for which</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="bookmark · re-read at design review time"
          >
            <CodeBlock language="bash" code={SUMMARY_TABLE} />
          </EditorFrame>

          <h2>Caveats</h2>

          <ul>
            <li>
              OpenAPI 3.1 only. Webhooks at the top level and JSON Schema
              2020-12 keywords <em>do not exist</em> in 3.0. If your generator
              targets 3.0 you&apos;ll silently lose the webhooks block.
            </li>
            <li>
              Discriminator mapping is required by some generators. A few SDK
              generators won&apos;t build proper tagged unions without an
              explicit mapping. The helpers in DaloyJS emit one by default, keep
              it.
            </li>
            <li>
              Webhook signing isn&apos;t the spec&apos;s job. The header lives
              in the spec; the algorithm and the secret rotation strategy do
              not. Pick one (HMAC-SHA256 of the raw body, hex), document it in
              the operation <code>description</code>
              {", "}and ship a signing helper next to the client SDK so
              consumers don&apos;t roll their own.
            </li>
          </ul>

          <h2>Where to go next</h2>

          <p>
            The post that&apos;s closest in spirit is{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              Contract-First Without the Codegen Dance
            </Link>
            {", "}same philosophy, different feature surface. For the recipient
            side of any of this, the{" "}
            <Link href="/blog/problem-details-done-right-rfc-9457-errors">
              RFC 9457 errors post
            </Link>{" "}
            explains why your callback/webhook responses should be problem+json
            all the way down. And if you&apos;re still assembling the route
            table itself, the{" "}
            <Link href="/blog/building-a-bookstore-api-with-daloyjs-from-scratch">
              bookstore tutorial
            </Link>{" "}
            is the route-by-route starter.
          </p>

          <p>
            Webhooks, callbacks, and discriminators are the three places where
            an OpenAPI document earns its keep. If your spec doesn&apos;t
            describe them today, the generated client doesn&apos;t know about
            them, the consumer&apos;s code is full of <code>unknown</code>
            {", "}and the &quot;just check the PDF&quot; messages have already
            started landing in support. Pick one feature this sprint and wire it
            into the OpenAPI document while the contract is still small.
          </p>

          <p>Devlin</p>
        </div>

        <Separator className="my-12" />

        <footer className="not-prose">
          <div className="rounded-xl border bg-muted/40 p-6">
            <p className="text-sm font-medium text-foreground">{POST.author}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {POST.authorBio}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link href="/docs" className="underline underline-offset-4">
                Read the docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/contract-first-without-the-codegen-dance"
                className="underline underline-offset-4"
              >
                Contract-first post
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link href="/blog" className="underline underline-offset-4">
                More posts
              </Link>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}
