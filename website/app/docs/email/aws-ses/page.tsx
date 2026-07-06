import Link from "next/link";
import { CodeBlock } from "../../../../components/code-block";
import { SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Send email from DaloyJS with AWS SES (SESv2)",
  description:
    "Send transactional email from a DaloyJS API using Amazon SES via the AWS SDK for JavaScript v3 (@aws-sdk/client-sesv2). Includes IAM setup, the SendEmailCommand interface, and runtime tips for Node and AWS Lambda.",
  path: "/docs/email/aws-ses",
  keywords: [
    "DaloyJS AWS SES",
    "@aws-sdk/client-sesv2",
    "SendEmailCommand",
    "AWS SES Node.js",
    "SES Lambda DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Send email from DaloyJS with AWS SES</h1>
      <p>
        <a href="https://aws.amazon.com/ses/" target="_blank" rel="noreferrer">
          Amazon Simple Email Service
        </a>{" "}
        (SES) is AWS&apos;s pay-as-you-go transactional and bulk email service.
        This guide uses <strong>SESv2</strong>: the current API, through the{" "}
        <a
          href="https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/"
          target="_blank"
          rel="noreferrer"
        >
          AWS SDK for JavaScript v3
        </a>
        . Best fit when you already run on AWS (Lambda, ECS, Fargate, EC2) or
        need very low per-message cost.
      </p>

      <SequenceDiagram
        title="Send through SESv2, then track events"
        participants={[
          "Route handler",
          "SESv2Client",
          "Amazon SES",
          "SNS / EventBridge",
        ]}
        steps={[
          {
            from: "Route handler",
            to: "SESv2Client",
            label: "send(SendEmailCommand)",
            detail: "FromEmailAddress, Destination, Content.Simple",
            kind: "request",
          },
          {
            from: "SESv2Client",
            to: "Amazon SES",
            label: "Signed HTTPS call (AWS SigV4)",
            detail: "ses:SendEmail via IAM role or keys",
            kind: "request",
          },
          {
            from: "Amazon SES",
            to: "Route handler",
            label: "Accepted",
            detail: "out.MessageId returned as { id }",
            kind: "response",
          },
          {
            from: "Amazon SES",
            to: "SNS / EventBridge",
            label: "Delivery, bounce, complaint events",
            detail: "via a configuration set (ConfigurationSetName)",
            kind: "async",
          },
        ]}
        caption="The route handler sends through the SESv2Client, which signs the request and calls Amazon SES. SES returns a MessageId synchronously, then publishes delivery and bounce events asynchronously when you attach a configuration set."
      />

      <h2 id="1-provision">1. Provision</h2>
      <ol>
        <li>
          In the AWS console, open{" "}
          <strong>Amazon SES → Verified identities</strong> and verify either an
          email address (for development) or your sending domain (for
          production). Add the SPF, DKIM, and DMARC records SES shows you.
        </li>
        <li>
          New accounts start in the SES <strong>sandbox</strong>: you can only
          send to verified addresses. Request production access from{" "}
          <strong>Account dashboard</strong> before launching.
        </li>
        <li>
          Create an IAM principal that can call <code>ses:SendEmail</code>.
          Prefer an <strong>execution role</strong> attached to your Lambda or
          container, avoid long-lived access keys.
        </li>
      </ol>

      <h2 id="2-install">2. Install</h2>
      <CodeBlock code={`pnpm add @aws-sdk/client-sesv2`} />
      <p>
        The v3 SDK is modular, install only the SESv2 client. It works on Node
        18+ and is compatible with the{" "}
        <Link href="/docs/adapters">Lambda adapter</Link>.
      </p>

      <h2 id="3-environment-variables">3. Environment variables</h2>
      <CodeBlock
        code={`# .env
AWS_REGION=us-east-1
SES_FROM_ADDRESS="Acme <no-reply@acme.example.com>"

# Local development only - in AWS, prefer the execution role
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...`}
      />

      <h2 id="4-plugin">4. Plugin</h2>
      <p>
        The SDK reads credentials from the standard AWS provider chain (env
        vars, shared config file, IMDS, IRSA on EKS, Lambda role), so the client
        itself takes no secrets.
      </p>
      <CodeBlock
        code={`// src/plugins/ses.ts
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type { App } from "@daloyjs/core";

const client = new SESv2Client({ region: process.env.AWS_REGION });

export const sesPlugin = {
  name: "ses",
  register(app: App) {
    app.decorate("email", {
      async send({ to, subject, text, html }) {
        const input: SendEmailCommandInput = {
          FromEmailAddress: process.env.SES_FROM_ADDRESS!,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: {
                ...(text ? { Text: { Data: text, Charset: "UTF-8" } } : {}),
                ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}),
              },
            },
          },
        };
        const out = await client.send(new SendEmailCommand(input));
        return { id: out.MessageId ?? "" };
      },
    });
    app.onClose(() => client.destroy());
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
import { sesPlugin } from "./plugins/ses";

const app = new App();
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 10 }));
app.register(sesPlugin);

app.route({
  method: "POST",
  path: "/notify",
  operationId: "sendWelcome",
  request: {
    body: z.object({
      to: z.email(),
      name: z.string().min(1).max(80),
    }),
  },
  responses: {
    202: { description: "Queued", body: z.object({ id: z.string() }) },
  },
  handler: async ({ body, state }) => {
    const { id } = await state.email.send({
      to: body.to,
      subject: \`Welcome, \${body.name}!\`,
      text: \`Hi \${body.name}, thanks for signing up.\`,
      html: \`<p>Hi \${body.name}, thanks for signing up.</p>\`,
    });
    return { status: 202, body: { id } };
  },
});`}
      />

      <h2 id="templates-and-attachments">Templates &amp; attachments</h2>
      <p>
        SESv2&apos;s <code>SendEmailCommand</code> accepts three content
        variants:
      </p>
      <ul>
        <li>
          <code>Content.Simple</code>: subject + text/HTML body (used above).
          Also supports an <code>Attachments</code> array with base64{" "}
          <code>RawContent</code>, <code>FileName</code>, and{" "}
          <code>ContentType</code>.
        </li>
        <li>
          <code>Content.Raw.Data</code>: a fully MIME-encoded message (use{" "}
          <a
            href="https://nodemailer.com/extras/mailcomposer/"
            target="_blank"
            rel="noreferrer"
          >
            mailcomposer
          </a>{" "}
          or <code>nodemailer</code>&apos;s composer if you need rich
          attachments).
        </li>
        <li>
          <code>Content.Template</code>: render an SES template by{" "}
          <code>TemplateName</code> with a JSON <code>TemplateData</code>{" "}
          payload. Create templates ahead of time with{" "}
          <code>CreateEmailTemplateCommand</code>.
        </li>
      </ul>

      <h2 id="runtimes">Runtimes</h2>
      <ul>
        <li>
          <strong>Node / Bun / Deno / AWS Lambda</strong>: works out of the box.
          On Lambda, omit access keys and let the execution role supply
          credentials.
        </li>
        <li>
          <strong>Cloudflare Workers</strong>: the SDK can run there
          but uses a Web Crypto signer; pin <code>@aws-sdk/client-sesv2</code> ≥
          3.700 and pass <code>credentials</code> explicitly (the default
          provider chain expects Node APIs).
        </li>
      </ul>

      <h2 id="observability">Observability</h2>
      <p>
        SES publishes <strong>delivery, bounce, and complaint</strong> events to
        SNS, EventBridge, or Kinesis Firehose via a <em>configuration set</em>.
        Add <code>ConfigurationSetName</code> to{" "}
        <code>SendEmailCommandInput</code> to opt in.
      </p>

      <p>
        See also <Link href="/docs/email/resend">Resend</Link>,{" "}
        <Link href="/docs/email/sendgrid">SendGrid</Link>, and the{" "}
        <Link href="/docs/email">email integrations overview</Link>.
      </p>
    </>
  );
}
