import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Send email from DaloyJS with SendGrid",
  description:
    "Send transactional email from a DaloyJS API using Twilio SendGrid's @sendgrid/mail SDK. Includes API key setup, the Mail Send v3 interface, sender verification, and DaloyJS plugin pattern.",
  path: "/docs/email/sendgrid",
  keywords: [
    "DaloyJS SendGrid",
    "@sendgrid/mail",
    "Twilio SendGrid Node.js",
    "SendGrid Mail Send v3",
    "transactional email DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Send email from DaloyJS with SendGrid</h1>
      <p>
        <a href="https://sendgrid.com/" target="_blank" rel="noreferrer">
          Twilio SendGrid
        </a>{" "}
        is a long-standing email delivery service that combines transactional
        and marketing sending. This guide uses the official{" "}
        <a
          href="https://github.com/sendgrid/sendgrid-nodejs/tree/main/packages/mail"
          target="_blank"
          rel="noreferrer"
        >
          <code>@sendgrid/mail</code>
        </a>{" "}
        SDK, which wraps the v3 Mail Send REST API.
      </p>

      <SequenceDiagram
        title="Send through @sendgrid/mail"
        participants={[
          "Route handler",
          "sgMail",
          "SendGrid v3 API",
          "Event Webhook",
        ]}
        steps={[
          {
            from: "Route handler",
            to: "sgMail",
            label: "sgMail.send({ from, to, subject, text })",
            detail: "API key set once via sgMail.setApiKey()",
            kind: "request",
          },
          {
            from: "sgMail",
            to: "SendGrid v3 API",
            label: "POST /v3/mail/send",
            detail: "Bearer token, JSON body",
            kind: "request",
          },
          {
            from: "SendGrid v3 API",
            to: "Route handler",
            label: "202 Accepted",
            detail: "X-Message-Id header returned as { id }",
            kind: "response",
          },
          {
            from: "SendGrid v3 API",
            to: "Event Webhook",
            label: "delivered, bounce, open events",
            detail: "verify the signature before trusting payloads",
            kind: "async",
          },
        ]}
        caption="The plugin sets the API key once, then sgMail.send() POSTs to the v3 Mail Send API. SendGrid replies 202 with an X-Message-Id, and later posts delivery events to your Event Webhook."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create a SendGrid account, enable 2FA, then go to{" "}
          <strong>Settings -&gt; API Keys</strong> and generate a{" "}
          <em>Restricted Access</em> key with only{" "}
          <strong>Mail Send -&gt; Full Access</strong> enabled.
        </li>
        <li>
          Complete{" "}
          <a
            href="https://www.twilio.com/docs/sendgrid/ui/account-and-settings/how-to-set-up-domain-authentication"
            target="_blank"
            rel="noreferrer"
          >
            Domain Authentication
          </a>{" "}
          (SPF/DKIM CNAMEs) for your sending domain, or use Single Sender
          Verification for quick tests only.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @sendgrid/mail`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM="Acme <no-reply@acme.example.com>"`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/sendgrid.ts
import sgMail from "@sendgrid/mail";
import type { App } from "@daloyjs/core";

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export const sendgridPlugin = {
  name: "sendgrid",
  register(app: App) {
    app.decorate("email", {
      async send({ to, subject, text, html }) {
        const [res] = await sgMail.send({
          from: process.env.SENDGRID_FROM!,
          to,
          subject,
          text,
          html,
        });
        // SendGrid returns 202 with an X-Message-Id header on success
        const id = res.headers["x-message-id"] ?? "";
        return { id: String(id) };
      },
    });
  },
};

declare module "@daloyjs/core" {
  interface AppState {
    email: {
      send(msg: {
        to: string;
        subject: string;
        text?: string;
        html?: string;
      }): Promise<{ id: string }>;
    };
  }
}`}
      />

      <h2 id="5-use-it-in-a-route">5. Use it in a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { sendgridPlugin } from "./plugins/sendgrid.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.register(sendgridPlugin);

app.post(
  "/contact",
  {
    operationId: "submitContact",
    request: {
      body: z.object({
        to: z.email(),
        subject: z.string().min(1).max(200),
        message: z.string().min(1).max(5000),
      }),
    },
    responses: {
      202: { description: "Queued", body: z.object({ id: z.string() }) },
    },
  },
  async ({ body, state }) => {
    const { id } = await state.email.send({
      to: body.to,
      subject: body.subject,
      text: body.message,
    });
    return { status: 202, body: { id } };
  },
);`}
      />

      <h2 id="dynamic-templates">Dynamic templates</h2>
      <p>
        For server-side templating, create a{" "}
        <a
          href="https://www.twilio.com/docs/sendgrid/ui/sending-email/how-to-send-an-email-with-dynamic-templates"
          target="_blank"
          rel="noreferrer"
        >
          Dynamic Transactional Template
        </a>{" "}
        in the SendGrid UI and pass its ID with substitution values:
      </p>
      <CodeBlock
        code={`await sgMail.send({
  from: process.env.SENDGRID_FROM!,
  to,
  templateId: "d-1234567890abcdef1234567890abcdef",
  dynamicTemplateData: {
    firstName: "Devlin",
    cartUrl: "https://acme.example.com/cart/abc",
  },
});`}
      />

      <h2 id="error-handling">Error handling</h2>
      <p>
        On non-2xx responses the SDK throws an error with{" "}
        <code>response.body.errors</code> describing each failure. Surface those
        to your client through the standard{" "}
        <Link href="/docs/errors">problem+json</Link> helper rather than echoing
        raw text.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The <code>@sendgrid/mail</code> package is Node-oriented (it uses{" "}
        <code>@sendgrid/client</code> with Node&apos;s HTTPS module). For{" "}
        <Link href="/docs/adapters">Cloudflare Workers</Link>
        {", "}call the v3 REST API directly with <code>fetch</code> against{" "}
        <code>https://api.sendgrid.com/v3/mail/send</code> using the same JSON
        body and a <code>Bearer</code> token.
      </p>

      <p>
        See also <Link href="/docs/email/resend">Resend</Link>
        {", "}
        <Link href="/docs/email/postmark">Postmark</Link>
        {", "}and the{" "}
        <Link href="/docs/email">email integrations overview</Link>.
      </p>
    </>
  );
}
