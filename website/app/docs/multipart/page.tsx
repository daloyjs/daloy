import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "File uploads (multipart/form-data)",
  description:
    "Model multipart/form-data uploads in DaloyJS with typed file fields, per-field MIME, magic-byte, and size caps, plus OpenAPI-aware emission.",
  path: "/docs/multipart",
  keywords: [
    "multipart",
    "form-data",
    "file upload",
    "fileField",
    "magicBytes",
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
        DaloyJS treats <code>multipart/form-data</code> as a first-class request
        shape. Two helpers, <code>fileField()</code> and{" "}
        <code>multipartObject()</code>, let you describe an upload contract
        once, get runtime validation (size caps, MIME allowlists, filename
        matchers), an end-to-end-typed handler, and a correct OpenAPI document
        with <code>multipart/form-data</code> media type and{" "}
        <code>format: &quot;binary&quot;</code> file fields.
      </p>
      <p>
        DaloyJS does not buffer file bodies for you: the runtime{" "}
        <code>FormData</code> entry stays a <code>File</code> or{" "}
        <code>Blob</code>, so handlers can stream it (<code>file.stream()</code>
        ) directly to S3, disk, or another upstream.
      </p>

      <FlowDiagram
        title="How an upload is validated"
        numbered
        steps={[
          {
            eyebrow: "request",
            label: "multipart/form-data body",
            detail: "File / Blob entries kept, not buffered",
          },
          {
            eyebrow: "app caps",
            label: "maxFileBytes · maxFields · maxFiles",
            detail: "413 (size) or 400 (counts)",
            tone: "muted",
          },
          {
            eyebrow: "field caps",
            label: "fileField(): size · MIME · magic bytes",
            detail: "forged image/png rejected, 422",
            tone: "accent",
          },
          {
            eyebrow: "handler",
            label: "Typed body",
            detail: "body.file.stream() to S3 or disk",
            tone: "success",
          },
        ]}
        caption="App-level caps are evaluated as soon as the body is parsed, so an oversized or over-counted request is rejected before the handler runs. Per-field fileField() checks (size, MIME allowlist, magic bytes) then surface mismatches as a 422 problem+json, leaving the handler a fully typed body."
      />

      <h2>Quick start</h2>
      <CodeBlock
        code={`import { z } from "zod";
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
        magicBytes: true,
      }),
    }),
  },
  responses: {
    201: {
      description: "Created",
      body: z.object({ ok: z.boolean() }),
    },
  },
  handler: async ({ body }) => {
    // body.file is a File; body.title is a validated string.
    const stream = body.file.stream(); // pass this to S3, disk, or another upstream
    void stream;
    return { status: 201 as const, body: { ok: true } };
  },
});`}
      />

      <h2>fileField() options</h2>
      <ul>
        <li>
          <code>maxBytes</code>: reject files larger than this many bytes.
        </li>
        <li>
          <code>accept</code>: MIME allowlist. Each entry can be exact (
          <code>&quot;image/png&quot;</code>) or a wildcard (
          <code>&quot;image/*&quot;</code> / <code>&quot;*/*&quot;</code>).
        </li>
        <li>
          <code>filename(name)</code>: predicate for filename validation, useful
          for forcing extensions.
        </li>
        <li>
          <code>magicBytes</code>: verify file signatures before the handler
          receives the upload. <code>true</code> derives known signatures from{" "}
          <code>accept</code> for PNG, JPEG, GIF, WebP, PDF, ZIP, and GZIP;
          custom signatures support domain-specific formats.
        </li>
        <li>
          <code>rejectScriptableImages</code>: reject SVG, MVG, MSL, PostScript,
          and EPS payloads that can execute inside renderers such as
          ImageMagick. This is enabled automatically when{" "}
          <code>magicBytes</code> is configured; set it to <code>false</code>{" "}
          only when the renderer is sandboxed.
        </li>
        <li>
          <code>optional</code>: when <code>true</code>, accept{" "}
          <code>undefined</code>/<code>null</code> values without raising.
        </li>
        <li>
          <code>format</code>: OpenAPI hint, defaults to{" "}
          <code>&quot;binary&quot;</code>.
        </li>
      </ul>

      <h2>Magic-byte verification</h2>
      <p>
        MIME types come from the client, so use <code>magicBytes</code> when the
        route only accepts formats with recognizable signatures. Daloy rejects a
        forged <code>image/png</code> upload whose bytes are not PNG bytes, and
        also rejects a file whose sniffed signature disagrees with the declared
        MIME type.
      </p>
      <CodeBlock
        code={`fileField({
  maxBytes: 1_000_000,
  accept: ["image/png", "image/jpeg"],
  magicBytes: true,
});

fileField({
  accept: ["application/x-daloy"],
  magicBytes: [
    { mime: "application/x-daloy", bytes: [0x44, 0x4c, 0x59] },
  ],
});`}
      />

      <h2>Strict form fields</h2>
      <p>
        By default, <code>multipartObject()</code> validates the fields you
        declare and ignores extra form fields. Pass{" "}
        <code>{`{ strict: true }`}</code> to reject undeclared fields and emit{" "}
        <code>additionalProperties: false</code> in OpenAPI.
      </p>
      <CodeBlock
        code={`const UploadBody = multipartObject(
  {
    title: z.string().min(1),
    file: fileField({ accept: ["application/pdf"], magicBytes: true }),
  },
  { strict: true },
);`}
      />

      <h2>App-level safety caps</h2>
      <p>
        The framework already enforces <code>bodyLimitBytes</code> on every
        request. For multipart bodies you can layer additional limits via{" "}
        <code>AppOptions.multipart</code>:
      </p>
      <CodeBlock
        code={`new App({
  bodyLimitBytes: 10 * 1024 * 1024,
  multipart: {
    maxFileBytes: 5_000_000, // single-file cap
    maxFields:    32,        // total fields (file + non-file)
    maxFiles:     4,         // total file uploads
  },
});`}
      />
      <p>
        These caps are evaluated as soon as the body is parsed, so a request
        that exceeds them is rejected with <code>413 Payload Too Large</code>{" "}
        (size) or <code>400 Bad Request</code> (counts) before the handler runs.
      </p>

      <h2>OpenAPI emission</h2>
      <p>
        When the request body is built from <code>multipartObject()</code>, the
        OpenAPI generator emits <code>multipart/form-data</code> as the request
        body media type. Each <code>fileField</code> becomes{" "}
        <code>{`{ type: "string", format: "binary" }`}</code> with optional{" "}
        <code>x-accept</code>, <code>x-max-bytes</code>, and{" "}
        <code>x-magic-bytes</code> annotations so codegen tools and humans both
        see the constraints.
      </p>

      <h2>Validation errors</h2>
      <p>
        Field-level failures are returned as a standard{" "}
        <code>422 Unprocessable Content</code> problem+json document with one
        entry per failing field, same shape as JSON body validation, so clients
        have a single error path to handle.
      </p>
    </>
  );
}
