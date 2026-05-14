import { CodeBlock } from "@/components/code-block";

export const metadata = { title: "Errors & problem+json" };

export default function Page() {
  return (
    <>
      <h1>Errors & problem+json</h1>
      <p>
        DaloyJS errors are first-class. Every thrown <code>HttpError</code> serializes to{" "}
        <a href="https://www.rfc-editor.org/rfc/rfc9457" target="_blank" rel="noreferrer">RFC 9457 problem+json</a>{" "}
        with a stable <code>type</code> URI, a request-id, and the appropriate Content-Type.
      </p>

      <h2>Built-in error classes</h2>
      <CodeBlock code={`import {
  BadRequestError,            // 400
  ValidationError,            // 422
  UnauthorizedError,          // 401
  ForbiddenError,             // 403
  NotFoundError,              // 404
  MethodNotAllowedError,      // 405 + Allow header
  PayloadTooLargeError,       // 413
  UnsupportedMediaTypeError,  // 415
  RequestTimeoutError,        // 408
  TooManyRequestsError,       // 429 + Retry-After
  InternalError,              // 500 (detail redacted in production)
} from "daloy";`} />

      <h2>Throwing in a handler</h2>
      <CodeBlock code={`import { NotFoundError } from "daloy";

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  responses: { 200: { description: "ok" }, 404: { description: "missing" } },
  handler: async ({ params }) => {
    const user = await db.find(params.id);
    if (!user) throw new NotFoundError(\`user \${params.id} not found\`);
    return { status: 200, body: user };
  },
});`} />

      <h2>Wire format</h2>
      <CodeBlock language="json" code={`HTTP/1.1 404 Not Found
content-type: application/problem+json
x-request-id: c9aa8e1c-7a6e-4f1e-9f44-c2e5d2c4a431

{
  "type": "https://daloyjs.dev/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "user 42 not found",
  "instance": "/users/42",
  "requestId": "c9aa8e1c-7a6e-4f1e-9f44-c2e5d2c4a431"
}`} />

      <h2>Production redaction</h2>
      <p>
        When <code>NODE_ENV=production</code>, DaloyJS strips the <code>detail</code> field on any 5xx response
        so internal stack traces and SQL fragments don&apos;t leak to clients. The full error is still emitted
        to your logger via the <code>onError</code> hook.
      </p>

      <h2>Custom error classes</h2>
      <CodeBlock code={`import { HttpError } from "daloy";

export class QuotaExceededError extends HttpError {
  constructor(resource: string) {
    super({
      status: 429,
      title: "Quota exceeded",
      type: "https://api.example.com/errors/quota-exceeded",
      detail: \`Quota exceeded for \${resource}\`,
    });
  }
}`} />

      <h2>Custom <code>onError</code></h2>
      <CodeBlock code={`app.use(() => ({
  onError: [
    async ({ error, requestId, set }) => {
      logger.error({ err: error, requestId }, "request failed");
      // return a Response to override; otherwise DaloyJS serializes problem+json
    },
  ],
}));`} />
    </>
  );
}
