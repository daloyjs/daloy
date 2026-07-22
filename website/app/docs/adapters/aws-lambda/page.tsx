import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "AWS Lambda adapter",
  description:
    "Run DaloyJS on AWS Lambda with API Gateway HTTP API (v2.0), API Gateway REST API (v1.0), and Lambda Function URLs. Includes streamifyResponse and Lambda Web Adapter notes.",
  path: "/docs/adapters/aws-lambda",
  keywords: [
    "DaloyJS AWS Lambda",
    "Lambda Function URLs",
    "API Gateway HTTP API v2",
    "API Gateway REST API v1",
    "toLambdaHandler",
    "streamifyResponse",
    "Lambda Web Adapter",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>AWS Lambda</h1>
      <p>
        The Lambda adapter accepts{" "}
        <strong>API Gateway HTTP API payload v2.0</strong>
        {", "}
        <strong>API Gateway REST API payload v1.0</strong>
        {", "}and <strong>Lambda Function URLs</strong> without configuration.
        It handles base64 bodies, v2 <code>cookies</code>
        {", "}v1 <code>multiValueHeaders</code>
        {", "}and forwards method, path, query, and headers into a standard{" "}
        <code>Request</code>.
      </p>

      <FlowDiagram
        title="Lambda adapter request path"
        steps={[
          {
            eyebrow: "trigger",
            label: "HTTP API v2 · REST v1 · Function URL",
            detail: "Lambda event payload",
          },
          {
            eyebrow: "adapter",
            label: "toLambdaHandler(app)",
            detail: "decodes base64, cookies, multiValueHeaders",
            tone: "muted",
          },
          {
            eyebrow: "core",
            label: "app.fetch(Request)",
            detail: "routing · hooks · handler",
            tone: "accent",
          },
          {
            eyebrow: "trigger",
            label: "Lambda result",
            detail: "or streamed via toLambdaStreamHandler",
            tone: "success",
          },
        ]}
        caption="toLambdaHandler normalizes all three event shapes into one web-standard Request, runs app.fetch, then serializes the Response back into the Lambda result. Swap in toLambdaStreamHandler for SSE or large downloads."
      />

      <h2 id="when-to-choose-lambda">When to choose Lambda</h2>
      <ul>
        <li>You already run on AWS and want IAM-integrated invocation.</li>
        <li>You want per-request billing without managing a server.</li>
        <li>
          You need long timeouts (up to 15 minutes) or larger memory than edge
          functions allow.
        </li>
      </ul>

      <h2 id="install">Install</h2>
      <p>
        The adapter ships with <code>@daloyjs/core</code>
        {". "}For deployment, use AWS SAM, CDK, the Serverless Framework, or any
        IaC of your choice.
      </p>

      <h2 id="function-url-or-api-gateway-http-api">
        Function URL or API Gateway HTTP API
      </h2>
      <CodeBlock
        language="ts"
        code={`// src/lambda.ts
import { toLambdaHandler } from "@daloyjs/core/lambda";
import { app } from "./server.js";

export const handler = toLambdaHandler(app);`}
      />

      <h2 id="streaming-responses">Streaming responses</h2>
      <p>
        Lambda supports response streaming via{" "}
        <code>awslambda.streamifyResponse</code>
        {". "}Use the streaming variant of the adapter when you need to flush
        headers and bytes incrementally (Server-Sent Events, large downloads).
      </p>
      <CodeBlock
        language="ts"
        code={`// src/lambda-stream.ts
import { toLambdaStreamHandler } from "@daloyjs/core/lambda";
import { app } from "./server.js";

export const handler = toLambdaStreamHandler(app);
// Uses awslambda.streamifyResponse + HttpResponseStream.from internally.`}
      />

      <h2 id="sam-template">SAM template</h2>
      <p>
        DaloyJS requires Node 24 LTS or Node 26+ (
        <code>engines.node: &quot;^24.0.0 || &gt;=26.0.0&quot;</code>). Use the
        <code>nodejs24.x</code> managed runtime where available, or ship a
        container image (see Lambda Web Adapter below) if your region&apos;s
        runtime catalog is older.
      </p>
      <CodeBlock
        language="yaml"
        code={`# template.yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31

Resources:
  Api:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: dist/
      Handler: lambda.handler
      Runtime: nodejs24.x
      MemorySize: 1024
      Timeout: 30
      FunctionUrlConfig:
        AuthType: NONE
        InvokeMode: BUFFERED   # or RESPONSE_STREAM for streaming`}
      />

      <h2 id="lambda-web-adapter-container-deployments">
        Lambda Web Adapter (container deployments)
      </h2>
      <p>
        If you prefer to ship a container image and keep the Node adapter, the{" "}
        <a
          href="https://github.com/awslabs/aws-lambda-web-adapter"
          target="_blank"
          rel="noreferrer"
        >
          AWS Lambda Web Adapter
        </a>{" "}
        translates Lambda invocations to plain HTTP. Useful when you want one
        image for both ECS and Lambda.
      </p>
      <CodeBlock
        language="docker"
        code={`FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 AS adapter
FROM node:24-slim
COPY --from=adapter /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /var/task
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY dist ./dist
ENV PORT=8080 AWS_LWA_PORT=8080
CMD ["node", "dist/server.js"]`}
      />

      <h2 id="gotchas">Gotchas</h2>
      <ul>
        <li>
          Callback-style handlers (
          <code>(event, context, callback) =&gt; ...</code>) are not supported
          on supported Node versions. Always use <code>async</code> handlers;
          the DaloyJS adapter does.
        </li>
        <li>
          For Function URLs with streaming, set{" "}
          <code>InvokeMode: RESPONSE_STREAM</code> and use{" "}
          <code>toLambdaStreamHandler</code>.
        </li>
        <li>
          Cold starts: prefer the Node adapter on provisioned concurrency or use
          a container with the Web Adapter for warmer reuse.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link href="/docs/adapters">Adapters overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/netlify">Netlify Functions</Link>
          {": "}v1 still uses the same Lambda event shape if you need it.
        </li>
        <li>
          <Link href="/docs/streaming">Streaming (SSE &amp; NDJSON)</Link>
        </li>
      </ul>
    </>
  );
}
