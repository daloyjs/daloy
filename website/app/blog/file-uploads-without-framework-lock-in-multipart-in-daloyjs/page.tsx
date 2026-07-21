import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "file-uploads-without-framework-lock-in-multipart-in-daloyjs",
  title: "File Uploads Without Framework Lock-In: Multipart in DaloyJS",
  description:
    "The fileField() and multipartObject() helpers: per-file size caps, MIME allowlists with wildcards, filename predicates, strict field validation, and OpenAPI binary schema emission, all while keeping the file as a Web standard File/Blob you can stream straight to S3, R2, or disk on any runtime.",
  date: "2026-06-01",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently writing TypeScript from a desk in Norway. Has spilled enough megabytes of base64-encoded JPEGs into production logs to have strong feelings about how upload code should look.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "multipart file upload",
    "DaloyJS fileField",
    "multipartObject",
    "MIME allowlist",
    "stream upload S3",
    "Web File Blob",
    "OpenAPI binary schema",
    "Cloudflare Workers upload",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const PAIN = `# Symptoms that your upload code grew into a small framework of its own:
#
# - You wrote a "uploadHandler" wrapper that buffers the whole file into a
#   Buffer, then re-emits it as a stream to S3. Memory usage during deploys
#   tracks how many users hit "send" simultaneously.
#
# - Your MIME check is a regex against the filename extension. Someone
#   uploaded "invoice.png.exe" and you only found out from a security audit.
#
# - The image-only endpoint accepts video/quicktime because nobody added
#   the allowlist to the new route last quarter. Discovered when storage
#   alerts fired at 02:13 on a Tuesday.
#
# - You ported the API to Cloudflare Workers and the entire upload
#   subsystem broke because it relied on a Node-only multipart parser.`;

const BAD_OLD_WAY = `// The pattern most Node frameworks teach. It looks reasonable until
// you try to run it on an edge runtime, or someone uploads a 4 GB MOV.
import multer from "multer";
import express from "express";

const upload = multer({
  dest: "/tmp/uploads",                       // disk! on a stateless deploy!
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("nope"));
    cb(null, true);
  },
});

const app = express();
app.post("/avatars", upload.single("file"), async (req, res) => {
  // req.file is a multer-shaped object. Not a standard Web File.
  // To get it to S3 you fs.createReadStream(req.file.path) - disk roundtrip.
  // To get it OUT of /tmp you remember to delete it (or you don't, and
  // /tmp fills up on every cold start).
});`;

const MULTIPART_OBJECT = `// src/routes/avatars.ts, the DaloyJS version.
// Two helpers do all the work, both Standard Schema compatible.
import { z } from "zod";
import { App, fileField, multipartObject } from "@daloyjs/core";

const AvatarUpload = multipartObject(
  {
    file: fileField({
      maxBytes: 5 * 1024 * 1024,              // 5 MB hard cap
      accept: ["image/png", "image/jpeg", "image/webp"],
      filename: (name) => /\\.(png|jpe?g|webp)$/i.test(name),
    }),
    alt: z.string().min(1).max(140),         // ← non-file fields use Zod (or any
                                             //   Standard-Schema-compatible lib)
    isPrimary: z.coerce.boolean().default(false),
  },
  { strict: true },                          // reject unknown form fields
);

app.route({
  method: "POST",
  path: "/avatars",
  operationId: "uploadAvatar",
  tags: ["Avatars"],
  request: { body: AvatarUpload },
  responses: {
    201: {
      description: "Avatar uploaded",
      body: z.object({ url: z.url() }),
    },
  },
  handler: async ({ body }) => {
    // body.file is a Web File / Blob - every runtime has it.
    // body.alt is a string. body.isPrimary is a real boolean.
    const url = await uploadToObjectStorage({
      stream: body.file.stream(),            // ← streams. no buffer-the-world.
      type:   body.file.type,
      size:   body.file.size,
      name:   body.file.name ?? "avatar",
    });
    return { status: 201, body: { url } };
  },
});`;

const VALIDATION_ERROR = `# Send a too-big WebP that's secretly a video disguised as one:
curl -sS -X POST http://localhost:3000/avatars \\
  -F file=@./vacation.mov;type=video/quicktime \\
  -F alt="My profile picture" -F isPrimary=true | jq .

# HTTP/1.1 422 Unprocessable Entity
# Content-Type: application/problem+json
{
  "type":   "https://daloyjs.dev/errors/validation",
  "title":  "Request validation failed",
  "status": 422,
  "detail": "Invalid body",
  "errors": [
    { "path": "file", "message": "File type \\"video/quicktime\\" not in accept list: image/png, image/jpeg, image/webp" },
    { "path": "file", "message": "File name \\"vacation.mov\\" rejected by filename matcher" }
  ]
}
# Zero handler code involved. The framework rejected the request before
# a single byte hit your business logic. Memory-safe by construction.`;

const FILE_FIELD_OPTIONS = `// fileField(options), every knob, in one place.
fileField({
  maxBytes: 10 * 1024 * 1024,                // hard cap on file.size
  accept:   ["image/*", "application/pdf"],  // exact or "type/*" wildcard
  filename: (name) => name.length <= 200,    // your custom predicate
  optional: true,                            // accept null/undefined as well
  format:   "binary",                        // OpenAPI hint, default "binary"
});

// Wildcard matching is lower-cased before comparison, so:
//   accept: ["IMAGE/PNG"]  ✓ matches image/png
//   accept: ["image/*"]    ✓ matches image/jpeg, image/webp, image/svg+xml
//   accept: ["*/*"]        ✓ matches anything (use sparingly; mostly for tests)`;

const MULTIPLE_FILES = `// Need an array of files? Wrap fileField() in your validator's array
// helper. Standard Schema is the only contract - Zod, Valibot, ArkType
// all work. Per-file rules still apply to every entry.
import { z } from "zod";
import { fileField, multipartObject } from "@daloyjs/core";

const GalleryUpload = multipartObject({
  // Browsers send <input type="file" multiple /> as a single field with
  // multiple parts. Whatever runtime adapter you're on, FormData.getAll()
  // gives you an array - and the framework hands it to your array schema.
  images: z.array(
    fileField({
      maxBytes: 20 * 1024 * 1024,
      accept: ["image/*"],
    }),
  ).min(1).max(50),
  albumId: z.uuid(),
});

// In your handler:
//   for (const img of body.images) {
//     await uploadToObjectStorage({ stream: img.stream(), ... });
//   }`;

const STREAMING = `// Streaming is the whole point. file.stream() returns a Web standard
// ReadableStream - the same shape on Node, Bun, Deno, Cloudflare
// and Workers. Pipe it to any compatible writer:

// 1) Cloudflare R2 (Workers binding):
await env.AVATARS.put(key, body.file.stream(), {
  httpMetadata: { contentType: body.file.type },
});

// 2) AWS S3 v3 SDK on Node/Bun:
import { Upload } from "@aws-sdk/lib-storage";
await new Upload({
  client: s3,
  params: {
    Bucket: "avatars",
    Key: key,
    Body: body.file.stream(),
    ContentType: body.file.type,
    ContentLength: body.file.size,
  },
}).done();

// 3) Disk on a long-lived Node instance:
import { Writable } from "node:stream";
import { createWriteStream } from "node:fs";
await body.file.stream().pipeTo(
  Writable.toWeb(createWriteStream("/var/data/" + key)),
);

// 4) Forward to another service over HTTP - no buffering at all:
await fetch(\`\${UPSTREAM}/store/\${key}\`, {
  method: "PUT",
  headers: { "content-type": body.file.type, "content-length": String(body.file.size) },
  body: body.file.stream(),
  // @ts-expect-error  half-duplex hint - Node 18+ needs this for streaming bodies
  duplex: "half",
});`;

const OPENAPI_OUTPUT = `// generated/openapi.json, what the spec looks like for the AvatarUpload route.
// Notice the "multipart/form-data" content type and the "binary" format hint
// on the file field. Every OpenAPI tool understands this shape.
{
  "paths": {
    "/avatars": {
      "post": {
        "operationId": "uploadAvatar",
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": {
                "type": "object",
                "required": ["file", "alt"],
                "properties": {
                  "file":      { "type": "string", "format": "binary" },
                  "alt":       { "type": "string", "minLength": 1, "maxLength": 140 },
                  "isPrimary": { "type": "boolean", "default": false }
                },
                "additionalProperties": false
              },
              "encoding": {
                "file": { "contentType": "image/png, image/jpeg, image/webp" }
              }
            }
          }
        },
        "responses": { "201": { /* ... */ } }
      }
    }
  }
}
// In Scalar's /docs UI the "Try it" panel renders a real file picker.
// In the Hey API generated SDK, uploadAvatar({ body: { file, alt, isPrimary } })
// is typed against the browser File type. No surprise stringification.`;

const TEST_UPLOAD = `// tests/avatars.test.ts, test the upload end-to-end without a port.
// FormData and File are part of Node 18+ (and every other modern runtime),
// so this works in your existing node:test setup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/build-app.ts";

test("uploadAvatar accepts a PNG and returns a URL", async () => {
  const app = buildApp();
  const png = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],         // a 4-byte "PNG"
    "me.png",
    { type: "image/png" },
  );
  const fd = new FormData();
  fd.set("file", png);
  fd.set("alt", "Me at the fjord");
  fd.set("isPrimary", "true");

  const res = await app.request("/avatars", { method: "POST", body: fd });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.url, /^https?:\\/\\//);
});

test("uploadAvatar rejects a too-big or wrong-type file as RFC 9457 422", async () => {
  const app = buildApp();
  const oversize = new File([new Uint8Array(6 * 1024 * 1024)], "huge.png", { type: "image/png" });
  const fd = new FormData();
  fd.set("file", oversize);
  fd.set("alt", "n/a");

  const res = await app.request("/avatars", { method: "POST", body: fd });
  assert.equal(res.status, 422);
  assert.equal(res.headers.get("content-type"), "application/problem+json");
});`;

const SECURITY_NOTES = `# A small checklist that has saved me from production-fire postmortems:

# 1) Always set maxBytes per field. The framework's bodyLimitBytes is the
#    OUTER limit on the whole request; fileField.maxBytes is per file.
#    Both should be set. The smaller one wins for a single-file upload.

# 2) Always set accept. "We'll figure it out later" is how you end up
#    hosting random EXEs and DMGs for free. Make the allowlist
#    aggressively narrow; expand only when you have a real use case.

# 3) Use strict: true on multipartObject. Extra form fields are almost
#    always a misconfigured frontend or an enumeration attempt.

# 4) Trust file.type for routing decisions; DO NOT trust it as a security
#    boundary. Run server-side magic-byte detection AFTER the upload if
#    the file ends up rendered or executed. (For static-only uploads to
#    a CDN bucket, the MIME allowlist is enough.)

# 5) Stream. Never new Uint8Array(await file.arrayBuffer()) unless you're
#    SURE the file is small. That line is the single biggest cause of
#    "why does my Workers script run out of memory at 25 MB?" in the wild.

# 6) Pick a deterministic key. file.name comes from the client. Use a
#    crypto.randomUUID() and store the original name as metadata instead.`;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: POST.title,
  description: POST.description,
  datePublished: POST.date,
  dateModified: POST.date,
  author: { "@type": "Person", name: POST.author },
  publisher: { "@type": "Organization", name: "DaloyJS", url: SITE_URL },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": `${SITE_URL}/blog/${POST.slug}`,
  },
  url: `${SITE_URL}/blog/${POST.slug}`,
};

function EditorFrame({
  files,
  activeFile,
  status,
  children,
  className,
}: {
  files: readonly string[];
  activeFile: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" aria-hidden />
          <span
            className="size-2.5 rounded-full bg-yellow-400/80"
            aria-hidden
          />
          <span className="size-2.5 rounded-full bg-green-400/80" aria-hidden />
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {files.map((file) => {
            const isActive = file === activeFile;
            return (
              <span
                key={file}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] sm:text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground"
                )}
              >
                {file}
              </span>
            );
          })}
        </div>
      </div>
      <div className="bg-background">{children}</div>
      {status ? (
        <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase sm:text-[11px]">
          <span className="truncate">{status}</span>
          <span aria-hidden>TS · UTF-8 · LF</span>
        </div>
      ) : null}
    </div>
  );
}

function CheckCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-3 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {badge}
        </Badge>
        <p className="leading-tight font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Uploads</Badge>
            <Badge variant="outline">Streams</Badge>
            <Badge variant="outline">Web standards</Badge>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            {POST.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            {POST.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{POST.author}</span>
            <span aria-hidden>·</span>
            <span>{POST.authorRole}</span>
            <span aria-hidden>·</span>
            <time dateTime={POST.date}>
              {dateFormatter.format(new Date(POST.date))}
            </time>
            <span aria-hidden>·</span>
            <span>{POST.readingTime}</span>
          </div>
        </header>

        <Separator className="mb-10" />

        <div className="docs-prose max-w-full">
          <p>
            Hi, Devlin. Ten years of fullstack, currently in Norway, currently
            nursing a strong opinion that file uploads should not be the part of
            your codebase that decides which runtime you can deploy to. And yet,
            for most of my career, it has been. A multer-shaped object here, a
            busboy stream there, a <code>/tmp/uploads</code> directory
            we&apos;re not allowed to talk about in serverless. You know the
            script.
          </p>

          <p>
            DaloyJS treats uploads the way the modern web platform does: you get
            back a <code>File</code> (which is a <code>Blob</code> with a{" "}
            <code>name</code>), which is the same shape on Node, Bun, Deno, and
            Cloudflare Workers. Two helpers, <code>fileField()</code> and{" "}
            <code>multipartObject()</code>
            {": "}give you per-file size caps, MIME allowlists, filename
            predicates, strict field validation, and OpenAPI binary schemas,
            without ever stepping outside the standard. This post is the tour.
          </p>

          <h2>The pain you&apos;re here to fix</h2>

          <EditorFrame
            files={["status-quo.txt"]}
            activeFile="status-quo.txt"
            status="four classic upload sins · all preventable"
          >
            <CodeBlock language="bash" code={PAIN} />
          </EditorFrame>

          <h2>What most Node code looks like today</h2>

          <EditorFrame
            files={["express + multer"]}
            activeFile="express + multer"
            status="disk roundtrip · framework-specific shape · no edge runtime support"
          >
            <CodeBlock language="ts" code={BAD_OLD_WAY} />
          </EditorFrame>

          <p>
            Three structural problems live in that snippet: the file goes to
            disk (you have no disk on Workers), the shape <code>req.file</code>{" "}
            is a multer thing rather than a Web File, and the validation rules
            are scattered across a config object, a <code>fileFilter</code>{" "}
            callback, and a downstream <code>try/catch</code>
            {". "}The DaloyJS version collapses all of it into one schema:
          </p>

          <h2>The two helpers, doing everything</h2>

          <EditorFrame
            files={["src/routes/avatars.ts"]}
            activeFile="src/routes/avatars.ts"
            status="multipartObject + fileField · streams everywhere · zero framework lock-in"
          >
            <CodeBlock language="ts" code={MULTIPART_OBJECT} />
          </EditorFrame>

          <p>Worth pointing at three things in that snippet:</p>

          <CheckCard badge="1" title="File fields and form fields coexist">
            <code>fileField()</code> validates uploads; <code>z.string()</code>
            {", "}
            <code>z.coerce.boolean()</code>
            {", "}and anything else Standard-Schema-shaped validate text
            fields. One <code>multipartObject({})</code> wraps both. You
            don&apos;t split your validation between &quot;the upload
            library&quot; and &quot;the validation library&quot;.
          </CheckCard>
          <CheckCard badge="2" title="strict: true rejects unknown fields">
            Extra form fields are usually either a misconfigured frontend
            (silent bugs) or someone fishing for parser behaviour. Reject them.
            The framework returns RFC 9457 422 with a problem+json body, same
            shape as every other validation error in the app.
          </CheckCard>
          <CheckCard badge="3" title="body.file is a real Web File">
            <code>body.file</code> is a <code>Blob &amp; {`{ name? }`}</code>
            {", "}
            which is the standard interop type. <code>file.stream()</code> is a{" "}
            <code>ReadableStream</code>. <code>file.arrayBuffer()</code> and{" "}
            <code>file.text()</code> work too if you really must. Same code path
            on every runtime.
          </CheckCard>

          <h2>The validation error you get for free</h2>

          <EditorFrame
            files={["terminal · curl"]}
            activeFile="terminal · curl"
            status="application/problem+json · zero bytes through your handler"
          >
            <CodeBlock language="bash" code={VALIDATION_ERROR} />
          </EditorFrame>

          <p>
            Notice that the rejection happens <em>before</em> the handler runs.
            By the time your business logic gets called, the file has already
            passed its size cap and its MIME check. That&apos;s the difference
            between a memory exhaustion bug and a 422 response. For the long
            version of why that error shape is what it is, see the{" "}
            <Link href="/blog/problem-details-done-right-rfc-9457-errors">
              RFC 9457 errors post</Link>
            {"."}
          </p>

          <h2>fileField(): every option, in one screen</h2>

          <EditorFrame
            files={["@daloyjs/core · multipart.ts"]}
            activeFile="@daloyjs/core · multipart.ts"
            status="five knobs · no hidden behavior"
          >
            <CodeBlock language="ts" code={FILE_FIELD_OPTIONS} />
          </EditorFrame>

          <h2>Arrays of files</h2>

          <EditorFrame
            files={["src/routes/gallery.ts"]}
            activeFile="src/routes/gallery.ts"
            status="wrap fileField in z.array() · per-file rules still apply"
          >
            <CodeBlock language="ts" code={MULTIPLE_FILES} />
          </EditorFrame>

          <h2>Streaming, on every runtime</h2>

          <p>
            This is the bit that pays for the abstraction. Because{" "}
            <code>body.file</code> is a Web <code>Blob</code>
            {", "}you get <code>file.stream()</code> for free, a{" "}
            <code>ReadableStream</code> with the exact same shape on Node, Bun,
            Deno, and Workers Edge. Four ways to use it, same handler code on
            all of them:
          </p>

          <EditorFrame
            files={["src/storage.ts"]}
            activeFile="src/storage.ts"
            status="R2 · S3 · disk · upstream HTTP, same Web ReadableStream"
          >
            <CodeBlock language="ts" code={STREAMING} />
          </EditorFrame>

          <p>
            The runtime-portability story for uploads is the same story as for
            everything else in this stack, see the{" "}
            <Link href="/blog/same-app-five-runtimes-verified">
              five-runtimes verification post</Link>
            {", "}but it&apos;s especially noticeable here because uploads are
            the one feature most Node frameworks accidentally pin you to Node
            for.
          </p>

          <h2>The OpenAPI shape this emits</h2>

          <EditorFrame
            files={["generated/openapi.json · /avatars"]}
            activeFile="generated/openapi.json · /avatars"
            status="multipart/form-data · type: string + format: binary · encoding.contentType"
          >
            <CodeBlock language="json" code={OPENAPI_OUTPUT} />
          </EditorFrame>

          <p>
            That means three nice things, automatically: the Scalar{" "}
            <code>/docs</code> UI shows a real file picker in the &quot;Try
            it&quot; panel; the Hey API generated SDK exposes a typed function
            whose <code>body.file</code> is a browser <code>File</code>; and any
            third-party tool that grok&apos;d OpenAPI 3.1 (Postman, Bruno,
            Speakeasy) renders the upload correctly without help.
          </p>

          <h2>Testing without a server</h2>

          <p>
            <code>FormData</code> and <code>File</code> are standard globals on
            Node 18+, Bun, and every other runtime DaloyJS ships an adapter for.
            Combine them with <code>app.request()</code> and you can test the
            entire upload path in-process. No port, no temp directory, no
            flakes:
          </p>

          <EditorFrame
            files={["tests/avatars.test.ts"]}
            activeFile="tests/avatars.test.ts"
            status="node:test + FormData + app.request() · runs in milliseconds"
          >
            <CodeBlock language="ts" code={TEST_UPLOAD} />
          </EditorFrame>

          <h2>The production checklist</h2>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="six rules · paste into your team's runbook"
          >
            <CodeBlock language="bash" code={SECURITY_NOTES} />
          </EditorFrame>

          <h2>Wrapping up</h2>

          <p>
            File uploads stop being a special case the moment you commit to two
            things: validate the file the same way you validate any other field,
            and never leave the Web standard <code>File</code> shape.{" "}
            <code>fileField()</code> handles the first; the rest of the
            framework handles the second. You get streaming on every runtime,
            OpenAPI binary schemas without extra work, RFC 9457 problem+json on
            every rejection, and an in-process test path that doesn&apos;t
            require touching disk. The &quot;upload subsystem&quot; folder you
            keep meaning to refactor, you might not need it anymore.
          </p>

          <p>
            For more pieces in the same vein:{" "}
            <Link href="/blog/middleware-without-mystery-hooks-ordering-response-transformation">
              the middleware post
            </Link>{" "}
            covers where to put auth around upload endpoints; the{" "}
            <Link href="/blog/secure-by-default">secure-by-default</Link> post
            covers the body limits and rate limits you get for free; and the{" "}
            <Link href="/blog/building-a-bookstore-api-with-daloyjs-from-scratch">
              bookstore tutorial
            </Link>{" "}
            is the broader starter walkthrough.
          </p>

          <p>Devlin</p>
        </div>

        <Separator className="my-12" />

        <footer className="not-prose">
          <div className="rounded-xl border bg-muted/40 p-6">
            <p className="text-sm font-medium text-foreground">{POST.author}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {POST.authorBio}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link href="/docs" className="underline underline-offset-4">
                Read the docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/same-app-five-runtimes-verified"
                className="underline underline-offset-4"
              >
                Five-runtimes post
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link href="/blog" className="underline underline-offset-4">
                More posts
              </Link>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}
