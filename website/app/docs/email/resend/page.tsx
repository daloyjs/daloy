import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Send email from DaloyJS with Resend",
  description:
    "Send transactional email from a DaloyJS API using Resend's official Node SDK. Includes API key setup, the resend.emails.send interface, React Email templates, and edge runtime support.",
  path: "/docs/email/resend",
  keywords: [
    "DaloyJS Resend",
    "Resend Node SDK",
    "React Email DaloyJS",
    "resend.emails.send",
    "edge email DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Send email from DaloyJS with Resend</h1>
      <p>
        <a href="https://resend.com" target="_blank" rel="noreferrer">
          Resend
        </a>{" "}
        is a developer-first email API with first-class TypeScript types,
        edge-runtime support, and tight integration with{" "}
        <a href="https://react.email" target="_blank" rel="noreferrer">
          React Email
        </a>{" "}
        templates. It&apos;s an excellent default for new DaloyJS projects.
      </p>

      <SequenceDiagram
        title="Send through the resend SDK"
        participants={["Route handler", "Resend SDK", "Resend API", "Webhooks"]}
        steps={[
          {
            from: "Route handler",
            to: "Resend SDK",
            label: "resend.emails.send({ from, to, subject })",
            detail: "uses the standard fetch API (edge-friendly)",
            kind: "request",
          },
          {
            from: "Resend SDK",
            to: "Resend API",
            label: "HTTPS request",
            detail: "Bearer RESEND_API_KEY",
            kind: "request",
          },
          {
            from: "Resend API",
            to: "Route handler",
            label: "{ data, error }",
            detail: "throw on error, else return { id: data.id }",
            kind: "response",
          },
          {
            from: "Resend API",
            to: "Webhooks",
            label: "delivered, bounced, complained events",
            detail: "verify the signature before trusting payloads",
            kind: "async",
          },
        ]}
        caption="resend.emails.send() runs on the standard fetch API, so it works on edge runtimes too. The SDK returns { data, error } rather than throwing, so handle the error branch and return data.id on success."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          Sign up at{" "}
          <a href="https://resend.com" target="_blank" rel="noreferrer">
            resend.com
          </a>{" "}
          and add a sending <strong>domain</strong> under{" "}
          <strong>Domains</strong>
          {". "}Add the SPF, DKIM, and DMARC DNS records Resend lists, then
          click <em>Verify</em>.
        </li>
        <li>
          Create an <strong>API key</strong> under <strong>API Keys</strong>
          {". "}
          Use a &ldquo;Sending access&rdquo; key scoped to that domain.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add resend`} />

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM="Acme <no-reply@acme.example.com>"`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <CodeBlock
        code={`// src/plugins/resend.ts
import { Resend } from "resend";
import type { App } from "@daloyjs/core";

const resend = new Resend(process.env.RESEND_API_KEY);

export const resendPlugin = {
  name: "resend",
  register(app: App) {
    app.decorate("email", {
      async send({ to, subject, text, html }) {
        const { data, error } = await resend.emails.send({
          from: process.env.RESEND_FROM!,
          to,
          subject,
          text,
          html,
        });
        if (error) throw new Error(error.message);
        return { id: data?.id ?? "" };
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
        Resend SDK methods return <code>{`{ data, error }`}</code> rather than
        throwing, handle the <code>error</code> branch and surface it through
        the <Link href="/docs/errors">DaloyJS error helpers</Link>.
      </p>

      <h2 id="5-use-it-in-a-route">5. Use it in a route</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, secureHeaders, rateLimit } from "@daloyjs/core";
import { resendPlugin } from "./plugins/resend.ts";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.register(resendPlugin);

app.post(
  "/magic-link",
  {
    operationId: "sendMagicLink",
    request: {
      body: z.object({ email: z.email() }),
    },
    responses: {
      202: { description: "Sent", body: z.object({ id: z.string() }) },
    },
  },
  async ({ body, state }) => {
    const link = await issueMagicLink(body.email); // your own logic
    const { id } = await state.email.send({
      to: body.email,
      subject: "Your sign-in link",
      text: \`Sign in: \${link}\`,
      html: \`<p>Sign in: <a href="\${link}">\${link}</a></p>\`,
    });
    return { status: 202, body: { id } };
  },
);

async function issueMagicLink(_email: string) {
  return "https://acme.example.com/auth/callback?token=...";
}`}
      />

      <h2 id="react-email-templates">React Email templates</h2>
      <p>
        Resend reads the <code>react</code> field and renders it to HTML for
        you, so you can ship type-safe email templates as React components:
      </p>
      <CodeBlock code={`pnpm add @react-email/components react react-dom`} />
      <CodeBlock
        code={`// emails/welcome.tsx
import { Html, Button, Heading, Text } from "@react-email/components";

export default function Welcome({ name }: { name: string }) {
  return (
    <Html>
      <Heading>Welcome, {name}!</Heading>
      <Text>Thanks for joining Acme.</Text>
      <Button href="https://acme.example.com/start">Get started</Button>
    </Html>
  );
}

// in the handler
import Welcome from "../../emails/welcome.tsx";

await resend.emails.send({
  from: process.env.RESEND_FROM!,
  to,
  subject: "Welcome to Acme",
  react: Welcome({ name: "Devlin" }),
});`}
      />

      <h2 id="batch-sending">Batch sending</h2>
      <p>
        Use <code>resend.batch.send([...])</code> to enqueue up to 100 messages
        in a single API call, handy for fan-out notifications without queueing
        infrastructure.
      </p>

      <h2 id="runtimes">Runtimes</h2>
      <p>
        The <code>resend</code> SDK uses the standard <code>fetch</code> API, so
        it runs on Node 18+, Bun, Deno, AWS Lambda, Vercel (Serverless and
        Edge), and Cloudflare Workers without adapters. Pair it with the{" "}
        <Link href="/docs/adapters">edge adapters</Link> shipped by DaloyJS.
      </p>

      <p>
        See also <Link href="/docs/email/postmark">Postmark</Link>
        {", "}
        <Link href="/docs/email/sendgrid">SendGrid</Link>
        {", "}and the{" "}
        <Link href="/docs/email">email integrations overview</Link>.
      </p>
    </>
  );
}
