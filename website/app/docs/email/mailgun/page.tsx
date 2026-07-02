import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Send email from DaloyJS with Mailgun",
  description:
    "Send transactional email from a DaloyJS API using Sinch Mailgun's mailgun.js SDK. Includes API key setup, the mg.messages.create interface, EU region support, and edge-runtime configuration.",
  path: "/docs/email/mailgun",
  keywords: [
    "DaloyJS Mailgun",
    "mailgun.js",
    "Mailgun Node SDK",
    "Mailgun EU region",
    "Mailgun Cloudflare Workers",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Send email from DaloyJS with Mailgun</h1>
      <p>
        <a href="https://www.mailgun.com" target="_blank" rel="noreferrer">
          Mailgun
        </a>{" "}
        (now Sinch Mailgun) offers high-volume transactional and bulk email,
        address validation, and routing. This guide uses the official{" "}
        <a
          href="https://github.com/mailgun/mailgun.js"
          target="_blank"
          rel="noreferrer"
        >
          <code>mailgun.js</code>
        </a>{" "}
        SDK.
      </p>

      <SequenceDiagram
        title="Send through the mailgun.js SDK"
        participants={["Route handler", "mg client", "Mailgun API", "Webhooks"]}
        steps={[
          {
            from: "Route handler",
            to: "mg client",
            label: "mg.messages.create(DOMAIN, { from, to, subject })",
            detail: "client keyed with MAILGUN_API_KEY",
            kind: "request",
          },
          {
            from: "mg client",
            to: "Mailgun API",
            label: "POST /v3/{domain}/messages",
            detail:
              "US api.mailgun.net or EU api.eu.mailgun.net (fixed per domain)",
            kind: "request",
          },
          {
            from: "Mailgun API",
            to: "Route handler",
            label: "{ id, message }",
            detail: "return { id } on success",
            kind: "response",
          },
          {
            from: "Mailgun API",
            to: "Webhooks",
            label: "delivery, bounce, complaint events",
            detail: "verify HMAC-SHA256(timestamp + token) before trusting",
            kind: "async",
          },
        ]}
        caption="The region is fixed per domain (US or EU), set url accordingly. On edge runtimes pass useFetch: true so the SDK uses native fetch. Webhook payloads are HMAC-signed, verify them before acting."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Add and verify your sending domain under{" "}
          <strong>Sending → Domains → Add new domain</strong>. Add the SPF/DKIM
          TXT records and the MX records Mailgun lists.
        </li>
        <li>
          Choose your <strong>region</strong>:{" "}
          <code>https://api.mailgun.net</code> (US, default) or{" "}
          <code>https://api.eu.mailgun.net</code> (EU). The region is fixed per
          domain.
        </li>
        <li>
          Create a <strong>Sending API key</strong> from{" "}
          <strong>API Security</strong> and store it as{" "}
          <code>MAILGUN_API_KEY</code>.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add mailgun.js form-data`} />
      <p>
        <code>form-data</code> is the multipart implementation Mailgun expects
        on Node.
      </p>

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MAILGUN_DOMAIN=mg.acme.example.com
MAILGUN_FROM="Acme <no-reply@mg.acme.example.com>"
# Optional: use EU
# MAILGUN_URL=https://api.eu.mailgun.net`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/mailgun.ts
import Mailgun from "mailgun.js";
import FormData from "form-data";
import type { App } from "@daloyjs/core";

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY!,
  url: process.env.MAILGUN_URL, // omit for the default US endpoint
});

const DOMAIN = process.env.MAILGUN_DOMAIN!;

export const mailgunPlugin = {
  name: "mailgun",
  register(app: App) {
    app.decorate("email", {
      async send({ to, subject, text, html }) {
        const res = await mg.messages.create(DOMAIN, {
          from: process.env.MAILGUN_FROM!,
          to: [to],
          subject,
          text,
          html,
        });
        return { id: res.id ?? "" };
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
import { mailgunPlugin } from "./plugins/mailgun";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.register(mailgunPlugin);

app.route({
  method: "POST",
  path: "/invites",
  operationId: "sendInvite",
  request: {
    body: z.object({
      to: z.string().email(),
      inviter: z.string().min(1).max(80),
    }),
  },
  responses: {
    202: { description: "Sent", body: z.object({ id: z.string() }) },
  },
  handler: async ({ body, state }) => {
    const { id } = await state.email.send({
      to: body.to,
      subject: \`\${body.inviter} invited you to Acme\`,
      text: \`\${body.inviter} invited you. Join: https://acme.example.com/join\`,
    });
    return { status: 202, body: { id } };
  },
});`}
      />

      <h2 id="templates">Templates</h2>
      <p>
        Create a stored template in <strong>Sending → Templates</strong> with{" "}
        <a href="https://handlebarsjs.com/" target="_blank" rel="noreferrer">
          Handlebars
        </a>{" "}
        syntax, then reference it by name and pass variables as a JSON string:
      </p>
      <CodeBlock
        code={`await mg.messages.create(DOMAIN, {
  from: process.env.MAILGUN_FROM!,
  to: [to],
  subject: "Welcome",
  template: "welcome",
  "h:X-Mailgun-Variables": JSON.stringify({ name: "Devlin" }),
});`}
      />

      <h2 id="runtimes">Runtimes</h2>
      <ul>
        <li>
          <strong>Node / Bun / AWS Lambda</strong>: works with the configuration
          above.
        </li>
        <li>
          <strong>Cloudflare Workers / Vercel</strong>: pass{" "}
          <code>useFetch: true</code> so the SDK uses the platform&apos;s native{" "}
          <code>fetch</code> instead of <code>request</code> (which depends on
          Node&apos;s HTTP module):
          <CodeBlock
            code={`const mg = mailgun.client({
  username: "api",
  key: process.env.MAILGUN_API_KEY!,
  url: process.env.MAILGUN_URL,
  useFetch: true,
});`}
          />
          When <code>useFetch</code> is enabled, you can also drop the{" "}
          <code>form-data</code> dependency in favour of the global{" "}
          <code>FormData</code>.
        </li>
      </ul>

      <h2 id="webhooks">Webhooks</h2>
      <p>
        Mailgun signs webhook payloads with HMAC-SHA256. When you accept
        delivery, bounce, or complaint events, verify{" "}
        <code>signature.signature</code> against <code>timestamp + token</code>{" "}
        using your webhook signing key before trusting the body.
      </p>

      <p>
        See also <Link href="/docs/email/aws-ses">AWS SES</Link>,{" "}
        <Link href="/docs/email/resend">Resend</Link>, and the{" "}
        <Link href="/docs/email">email integrations overview</Link>.
      </p>
    </>
  );
}
