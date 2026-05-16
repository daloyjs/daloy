import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "File uploads (multipart/form-data)",
  description:
    "Model multipart/form-data uploads in DaloyJS with typed file fields, per-field MIME and size caps, and OpenAPI-aware emission. Streams files to your handler without buffering them through the framework.",
  path: "/docs/multipart",
  keywords: [
    "multipart",
    "form-data",
    "file upload",
    "fileField",
    "multipartObject",
    "DaloyJS uploads",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>File uploads (multipart/form-data)</h1>
      <p>
        DaloyJS treats <code>multipart/form-data</code> as a first-class
        request shape. Two helpers — <code>fileField()</code> and{" "}
        <code>multipartObject()</code> — let you describe an upload contract
        once, get runtime validation (size caps, MIME allowlists, filename
        matchers), an end-to-end-typed handler, and a correct OpenAPI
        document with <code>multipart/form-data</code> media type and{" "}
        <code>format: &quot;binary&quot;</code> file fields.
      </p>
      <p>
        DaloyJS does not buffer file bodies for you: the runtime{" "}
        <code>FormData</code> entry stays a <code>File</code> or{" "}
        <code>Blob</code>, so handlers can stream it (<code>file.stream()</code>)
        directly to S3, disk, or another upstream.
      </p>

      <h2>Quick start</h2>
      <CodeBlock code={`import { z } from "zod";
import { App, fileField, multipartObject } from "@daloyjs/core";

const app = new App({
  // Optional defense-in-depth caps applied to every multipart request.
  multipart: { maxFileBytes: 5_000_000, maxFields: 32, maxFiles: 4 },
});

app.route({
  method: "POST",
  path: "/avatars",
  operationId: "uploadAvatar",
  request: {
    body: multipartObject({
      title: z.string().min(1),
      file: fileField({
        maxBytes: 1_000_000,
        accept: ["image/png", "image/jpeg"],
      }),
    }),
  },
  responses: { 201: { description: "Created" } },
  handler: async ({ body }) => {
    // body.file is a File; body.title is a validated string.
    await uploadToS3(body.file.stream(), body.file.type);
    return { status: 201 as const, body: { ok: true } };
  },
});`} />

      <h2>fileField() options</h2>
      <ul>
        <li>
          <code>maxBytes</code> — reject files larger than this many bytes.
        </li>
        <li>
          <code>accept</code> — MIME allowlist. Each entry can be exact
          (<code>&quot;image/png&quot;</code>) or a wildcard
          (<code>&quot;image/*&quot;</code> / <code>&quot;*/*&quot;</code>).
        </li>
        <li>
          <code>filename(name)</code> — predicate for filename validation,
          useful for forcing extensions.
        </li>
        <li>
          <code>optional</code> — when <code>true</code>, accept{" "}
          <code>undefined</code>/<code>null</code> values without raising.
        </li>
        <li>
          <code>format</code> — OpenAPI hint, defaults to{" "}
          <code>&quot;binary&quot;</code>.
        </li>
      </ul>

      <h2>App-level safety caps</h2>
      <p>
        The framework already enforces <code>bodyLimitBytes</code> on every
        request. For multipart bodies you can layer additional limits via{" "}
        <code>AppOptions.multipart</code>:
      </p>
      <CodeBlock code={`new App({
  bodyLimitBytes: 10 * 1024 * 1024,
  multipart: {
    maxFileBytes: 5_000_000, // single-file cap
    maxFields:    32,        // total fields (file + non-file)
    maxFiles:     4,         // total file uploads
  },
});`} />
      <p>
        These caps are evaluated as soon as the body is parsed, so a request
        that exceeds them is rejected with <code>413 Payload Too Large</code>{" "}
        (size) or <code>400 Bad Request</code> (counts) before the handler
        runs.
      </p>

      <h2>OpenAPI emission</h2>
      <p>
        When the request body is built from <code>multipartObject()</code>,
        the OpenAPI generator emits <code>multipart/form-data</code> as the
        request body media type. Each <code>fileField</code> becomes{" "}
        <code>{`{ type: "string", format: "binary" }`}</code> with optional{" "}
        <code>x-accept</code> and <code>x-max-bytes</code> annotations so
        codegen tools and humans both see the constraints.
      </p>

      <h2>Validation errors</h2>
      <p>
        Field-level failures are returned as a standard{" "}
        <code>422 Unprocessable Content</code> problem+json document with one
        entry per failing field — same shape as JSON body validation, so
        clients have a single error path to handle.
      </p>
    </>
  );
}
