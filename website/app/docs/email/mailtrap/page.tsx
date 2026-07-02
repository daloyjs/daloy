import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Send email from DaloyJS with Mailtrap",
  description:
    "Send transactional email from a DaloyJS API using the official mailtrap Node SDK. Includes sandbox vs. production sending, MailtrapClient configuration, and switching with a single flag.",
  path: "/docs/email/mailtrap",
  keywords: [
    "DaloyJS Mailtrap",
    "Mailtrap Node SDK",
    "MailtrapClient",
    "Mailtrap sandbox",
    "email testing DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Send email from DaloyJS with Mailtrap</h1>
      <p>
        <a href="https://mailtrap.io" target="_blank" rel="noreferrer">
          Mailtrap
        </a>{" "}
        bundles an <strong>Email Sandbox</strong> (safe test inbox) and an{" "}
        <strong>Email API/SMTP</strong> for production sending under one SDK.
        That makes it especially handy for staging environments: dev/staging
        captures messages, production actually delivers, with the same code
        path.
      </p>

      <BranchDiagram
        title="One client, two destinations"
        source={{
          eyebrow: "state.email.send(...)",
          label: "MailtrapClient",
          detail: "MAILTRAP_SANDBOX flips the mode",
        }}
        branches={[
          {
            eyebrow: "dev / staging",
            label: "Email Sandbox",
            detail: "sandbox: true + testInboxId · captured, never delivered",
          },
          {
            eyebrow: "production",
            label: "Email Sending",
            detail: "verified domain · delivered to recipients",
            tone: "success",
          },
        ]}
        caption="The same plugin code path serves every environment. Set MAILTRAP_SANDBOX=true in dev/staging to capture messages in a test inbox, and leave it off in production to deliver for real."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          For testing, open <strong>Email Sandbox → Inboxes</strong> and copy
          the inbox <strong>ID</strong> plus an <strong>API token</strong>{" "}
          scoped to the sandbox.
        </li>
        <li>
          For production, open <strong>Email Sending → Sending Domains</strong>,
          verify a domain via SPF/DKIM/DMARC records, then create an API token
          with <em>Email Sending</em> permissions.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add mailtrap`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
MAILTRAP_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MAILTRAP_FROM_EMAIL=no-reply@acme.example.com
MAILTRAP_FROM_NAME=Acme
# Sandbox mode (testing) - set both to enable
MAILTRAP_SANDBOX=true
MAILTRAP_TEST_INBOX_ID=1234567`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/mailtrap.ts
import { MailtrapClient } from "mailtrap";
import type { App } from "@daloyjs/core";

const sandbox = process.env.MAILTRAP_SANDBOX === "true";
const client = new MailtrapClient({
  token: process.env.MAILTRAP_TOKEN!,
  ...(sandbox
    ? { sandbox: true, testInboxId: Number(process.env.MAILTRAP_TEST_INBOX_ID) }
    : {}),
});

const FROM = {
  email: process.env.MAILTRAP_FROM_EMAIL!,
  name: process.env.MAILTRAP_FROM_NAME ?? "Acme",
};

export const mailtrapPlugin = {
  name: "mailtrap",
  register(app: App) {
    app.decorate("email", {
      async send({ to, subject, text, html }) {
        const res = await client.send({
          from: FROM,
          to: [{ email: to }],
          subject,
          text,
          html,
        });
        return { id: res.message_ids?.[0] ?? "" };
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
      <p>
        The same plugin works for dev, staging, and prod, flip{" "}
        <code>MAILTRAP_SANDBOX</code> per environment.
      </p>

      <h2 id="5-use-it-in-a-route">5. Use it in a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { mailtrapPlugin } from "./plugins/mailtrap";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.register(mailtrapPlugin);

app.route({
  method: "POST",
  path: "/feedback",
  operationId: "sendFeedback",
  request: {
    body: z.object({
      to: z.string().email(),
      message: z.string().min(1).max(2000),
    }),
  },
  responses: {
    202: { description: "Sent", body: z.object({ id: z.string() }) },
  },
  handler: async ({ body, state }) => {
    const { id } = await state.email.send({
      to: body.to,
      subject: "Thanks for your feedback",
      text: body.message,
    });
    return { status: 202, body: { id } };
  },
});`}
      />

      <h2 id="bulk-sending">Bulk sending</h2>
      <p>
        Mailtrap exposes a separate <strong>Bulk Sending</strong> stream
        optimised for marketing volume. Toggle it on the same client by setting{" "}
        <code>bulk: true</code> instead of <code>sandbox: true</code>:
      </p>
      <CodeBlock
        code={`const bulkClient = new MailtrapClient({
  token: process.env.MAILTRAP_TOKEN!,
  bulk: true,
});`}
      />

      <h2 id="templates">Templates</h2>
      <p>
        Create a template in <strong>Email Sending → Email Templates</strong>,
        then send it by UUID and provide variables instead of{" "}
        <code>subject</code>/<code>text</code>/<code>html</code>:
      </p>
      <CodeBlock
        code={`await client.send({
  from: FROM,
  to: [{ email: "user@example.com" }],
  template_uuid: "11111111-2222-3333-4444-555555555555",
  template_variables: { name: "Devlin", company: "Acme" },
});`}
      />

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The <code>mailtrap</code> SDK targets Node (uses Node&apos;s HTTPS
        module). For <Link href="/docs/adapters">Cloudflare Workers</Link> or{" "}
        <Link href="/docs/adapters">Vercel</Link>, call the REST API directly
        with <code>fetch</code>:{" "}
        <code>POST https://send.api.mailtrap.io/api/send</code> (production) or{" "}
        <code>
          POST https://sandbox.api.mailtrap.io/api/send/{`{inbox_id}`}
        </code>{" "}
        (sandbox), with header <code>Authorization: Bearer ${"{token}"}</code>.
      </p>

      <p>
        See also <Link href="/docs/email/resend">Resend</Link>,{" "}
        <Link href="/docs/email/postmark">Postmark</Link>, and the{" "}
        <Link href="/docs/email">email integrations overview</Link>.
      </p>
    </>
  );
}
