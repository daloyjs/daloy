import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Errors & problem+json",
  description:
    "Throw typed errors in DaloyJS and have them serialized as RFC 9457 problem+json responses by default. Customize, extend, and document errors in OpenAPI.",
  path: "/docs/errors",
  keywords: ["problem+json", "RFC 9457", "DaloyJS errors", "HTTP error responses", "typed errors TypeScript"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Errors & problem+json</h1>
      <p>
        DaloyJS errors are first-class. Every thrown <code>HttpError</code> serializes to{" "}
        <a href="https://www.rfc-editor.org/rfc/rfc9457" target="_blank" rel="noreferrer">RFC 9457 problem+json</a>{" "}
        with a stable <code>type</code> URI, a request-id, and the appropriate Content-Type.
      </p>

      <FlowDiagram
        title="From thrown error to problem+json"
        numbered
        steps={[
          {
            eyebrow: "handler",
            label: "throw new NotFoundError(...)",
            detail: "any HttpError subclass",
            tone: "accent",
          },
          {
            eyebrow: "framework",
            label: "Map to RFC 9457 fields",
            detail: "type · title · status · detail",
          },
          {
            eyebrow: "production",
            label: "Redact 5xx detail",
            detail: "NODE_ENV=production strips internals",
            tone: "muted",
          },
          {
            eyebrow: "wire",
            label: "Serialized response",
            detail: "application/problem+json + x-request-id",
            tone: "success",
          },
        ]}
        caption="A thrown HttpError becomes a problem+json document automatically. In production the detail field on 5xx responses is redacted so stack traces and SQL fragments never reach the client, while the full error still goes to your onError hook."
      />

      <h2 id="built-in-error-classes">Built-in error classes</h2>
      <CodeBlock code={`import {
  BadRequestError,                   // 400
  UnauthorizedError,                 // 401
  ForbiddenError,                    // 403
  NotFoundError,                     // 404
  MethodNotAllowedError,             // 405 + Allow header
  RequestTimeoutError,               // 408
  ConflictError,                     // 409 + cache-control: no-store
  PayloadTooLargeError,              // 413
  UnsupportedMediaTypeError,         // 415
  ValidationError,                   // 422
  TooManyRequestsError,              // 429 + Retry-After
  RequestHeaderFieldsTooLargeError,  // 431
  InternalError,                     // 500 (detail redacted in production)
} from "@daloyjs/core";`} />

      <h2 id="throwing-in-a-handler">Throwing in a handler</h2>
      <CodeBlock code={`import { NotFoundError } from "@daloyjs/core";

app.get(
  "/users/:id",
  {
    operationId: "getUser",
    responses: { 200: { description: "ok" }, 404: { description: "missing" } },
  },
  async ({ params }) => {
    const user = await db.find(params.id);
    if (!user) throw new NotFoundError(\`user \${params.id} not found\`);
    return { status: 200, body: user };
  },
);`} />

      <h2 id="wire-format">Wire format</h2>
      <p>
        The request id is returned to the client in two places: the <code>x-request-id</code> response
        header, and (per <a href="https://www.rfc-editor.org/rfc/rfc9457#name-members-of-a-problem-detail" target="_blank" rel="noreferrer">RFC&nbsp;9457 §3.1</a>)
        the problem document&apos;s <code>instance</code> field as a <code>urn:request:&lt;uuid&gt;</code> URN.
        There is no top-level <code>requestId</code> property, clients should read the header or parse the URN
        from <code>instance</code>.
      </p>
      <CodeBlock language="json" code={`HTTP/1.1 404 Not Found
content-type: application/problem+json
x-request-id: c9aa8e1c-7a6e-4f1e-9f44-c2e5d2c4a431

{
  "type": "https://daloyjs.dev/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "user 42 not found",
  "instance": "urn:request:c9aa8e1c-7a6e-4f1e-9f44-c2e5d2c4a431"
}`} />

      <h2 id="production-redaction">Production redaction</h2>
      <p>
        When <code>NODE_ENV=production</code>, DaloyJS strips the <code>detail</code> field on any 5xx response
        so internal stack traces and SQL fragments don&apos;t leak to clients. The full error is still emitted
        to your logger via the <code>onError</code> hook.
      </p>

      <h2 id="custom-error-classes">Custom error classes</h2>
      <CodeBlock code={`import { HttpError } from "@daloyjs/core";

export class QuotaExceededError extends HttpError {
  constructor(resource: string) {
    super(429, {
      title: "Quota exceeded",
      type: "https://api.example.com/errors/quota-exceeded",
      detail: \`Quota exceeded for \${resource}\`,
    });
  }
}`} />

      <h2 id="custom-onerror">Custom <code>onError</code></h2>
      <CodeBlock code={`app.use({
  onError: async (error, ctx) => {
    logger.error({ err: error, requestId: ctx?.requestId }, "request failed");
    // return a Response to override; otherwise DaloyJS serializes problem+json
  },
});`} />
    </>
  );
}
