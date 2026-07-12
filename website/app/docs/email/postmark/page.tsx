import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Send email from DaloyJS with Postmark",
  description:
    "Send transactional email from a DaloyJS API using the official postmark Node SDK. Includes server token setup, ServerClient.sendEmail, message streams, and template rendering.",
  path: "/docs/email/postmark",
  keywords: [
    "DaloyJS Postmark",
    "postmark Node SDK",
    "Postmark ServerClient",
    "message streams Postmark",
    "transactional email DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Send email from DaloyJS with Postmark</h1>
      <p>
        <a href="https://postmarkapp.com" target="_blank" rel="noreferrer">
          Postmark
        </a>{" "}
        is a transactional-first email provider known for very high inbox
        placement and detailed delivery analytics. This guide uses the official{" "}
        <a
          href="https://github.com/ActiveCampaign/postmark.js"
          target="_blank"
          rel="noreferrer"
        >
          <code>postmark</code>
        </a>{" "}
        SDK.
      </p>

      <SequenceDiagram
        title="Send through the postmark SDK"
        participants={[
          "Route handler",
          "ServerClient",
          "Postmark API",
          "Webhooks",
        ]}
        steps={[
          {
            from: "Route handler",
            to: "ServerClient",
            label: "client.sendEmail({ From, To, Subject, MessageStream })",
            detail: "MessageStream defaults to outbound",
            kind: "request",
          },
          {
            from: "ServerClient",
            to: "Postmark API",
            label: "POST /email",
            detail: "header X-Postmark-Server-Token",
            kind: "request",
          },
          {
            from: "Postmark API",
            to: "Route handler",
            label: "{ ErrorCode, MessageID }",
            detail:
              "throw unless ErrorCode === 0, else return { id: MessageID }",
            kind: "response",
          },
          {
            from: "Postmark API",
            to: "Webhooks",
            label: "delivery, bounce, spam-complaint events",
            detail: "verify the request before trusting payloads",
            kind: "async",
          },
        ]}
        caption="Postmark returns an ErrorCode rather than throwing, so the plugin checks ErrorCode === 0 and surfaces the MessageID as { id }. Pick the outbound or broadcast MessageStream per send."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Create a Postmark server under <strong>Servers → New server</strong>,
          then open it and copy the <strong>Server API Token</strong> from{" "}
          <strong>API Tokens</strong>.
        </li>
        <li>
          Add a <strong>Sender Signature</strong> (single address) or, for
          production, configure a full <strong>Sender Domain</strong> with DKIM
          and Return-Path records.
        </li>
        <li>
          Decide which <strong>Message Stream</strong> you&apos;ll use:
          <ul>
            <li>
              <code>outbound</code>: default transactional stream
            </li>
            <li>
              <code>broadcast</code>: bulk/marketing (must be enabled on the
              server)
            </li>
          </ul>
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add postmark`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
POSTMARK_SERVER_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
POSTMARK_FROM="Acme <no-reply@acme.example.com>"
POSTMARK_STREAM=outbound`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/postmark.ts
import { ServerClient } from "postmark";
import type { App } from "@daloyjs/core";

const client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!);

export const postmarkPlugin = {
  name: "postmark",
  register(app: App) {
    app.decorate("email", {
      async send({ to, subject, text, html }) {
        const res = await client.sendEmail({
          From: process.env.POSTMARK_FROM!,
          To: to,
          Subject: subject,
          TextBody: text,
          HtmlBody: html,
          MessageStream: process.env.POSTMARK_STREAM ?? "outbound",
        });
        // ErrorCode 0 means success
        if (res.ErrorCode !== 0) {
          throw new Error(\`Postmark error \${res.ErrorCode}: \${res.Message}\`);
        }
        return { id: res.MessageID };
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
import { postmarkPlugin } from "./plugins/postmark.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.register(postmarkPlugin);

app.post(
  "/receipts",
  {
    operationId: "sendReceipt",
    request: {
      body: z.object({
        to: z.email(),
        orderId: z.string().min(1),
        total: z.number().nonnegative(),
      }),
    },
    responses: {
      202: { description: "Sent", body: z.object({ id: z.string() }) },
    },
  },
  async ({ body, state }) => {
    const { id } = await state.email.send({
      to: body.to,
      subject: \`Receipt for order \${body.orderId}\`,
      text: \`Total: $\${body.total.toFixed(2)}\`,
      html: \`<p>Total: <strong>$\${body.total.toFixed(2)}</strong></p>\`,
    });
    return { status: 202, body: { id } };
  },
);`}
      />

      <h2 id="server-side-templates">Server-side templates</h2>
      <p>
        Create a template in <strong>Templates</strong> (Mustachio syntax), then
        send it by <code>TemplateAlias</code>:
      </p>
      <CodeBlock
        code={`await client.sendEmailWithTemplate({
  From: process.env.POSTMARK_FROM!,
  To: "user@example.com",
  TemplateAlias: "order-receipt",
  TemplateModel: {
    name: "Devlin",
    orderId: "1024",
    total: "42.00",
  },
  MessageStream: "outbound",
});`}
      />

      <h2 id="batch-sending">Batch sending</h2>
      <p>
        Use <code>client.sendEmailBatch([...])</code> or{" "}
        <code>client.sendEmailBatchWithTemplates([...])</code> to send up to 500
        messages per request, the response is an array with one result per
        message so you can inspect per-recipient errors.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The <code>postmark</code> SDK currently uses <code>axios</code> under
        the hood, so it targets Node and Node-compatible runtimes (Bun,
        Deno&apos;s Node-compat, AWS Lambda). For{" "}
        <Link href="/docs/adapters">Cloudflare Workers</Link>, call the REST endpoint
        directly with <code>fetch</code>:
        <code>POST https://api.postmarkapp.com/email</code> with the header{" "}
        <code>X-Postmark-Server-Token</code>.
      </p>

      <p>
        See also <Link href="/docs/email/resend">Resend</Link>,{" "}
        <Link href="/docs/email/mailgun">Mailgun</Link>, and the{" "}
        <Link href="/docs/email">email integrations overview</Link>.
      </p>
    </>
  );
}
