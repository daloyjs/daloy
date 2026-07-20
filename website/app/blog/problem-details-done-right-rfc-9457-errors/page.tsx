import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "problem-details-done-right-rfc-9457-errors",
  title: "Problem Details Done Right: RFC 9457 Errors in DaloyJS",
  description:
    "Why every framework needs a predictable error contract, and how DaloyJS uses RFC 9457 application/problem+json for HttpError, ValidationError, UnauthorizedError, TooManyRequestsError, and the rest, with automatic 5xx redaction in production and a Retry-After story that just works.",
  date: "2026-05-28",
  readingTime: "12 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Ten years of fullstack, currently writing TypeScript from a desk in Norway. Has spent more of his career parsing other people's error responses than writing his own, would prefer to fix that, for everyone.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "RFC 9457 problem+json",
    "DaloyJS HttpError",
    "ValidationError errors array",
    "UnauthorizedError",
    "TooManyRequestsError Retry-After",
    "5xx detail redaction production",
    "ProblemDetails type title status",
    "API error contract",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const BAD_OLD_WAY = `// What most JSON APIs ship today. Sound familiar?
//
// Endpoint A:
// HTTP/1.1 400 Bad Request
// Content-Type: application/json
// { "error": "invalid email" }
//
// Endpoint B (same app, different team):
// HTTP/1.1 400 Bad Request
// Content-Type: application/json
// { "code": "VALIDATION", "message": "Email is invalid", "fields": [...] }
//
// Endpoint C (third-party we forward to):
// HTTP/1.1 400 Bad Request
// Content-Type: application/json
// { "errors": [{ "detail": "email: invalid" }] }
//
// The frontend ends up with a switch statement keyed on the endpoint URL
// just to know where to grab the message from. The mobile app skips that
// and renders "Something went wrong" for every 4xx. Everyone is sad.`;

const PROBLEM_DETAILS_SHAPE = `// RFC 9457, Problem Details for HTTP APIs.
// (The successor to RFC 7807, same shape, clearer language.)
//
// One Content-Type: application/problem+json
// One required core:

interface ProblemDetails {
  type:     string;   // URI identifying the problem class (e.g. .../errors/validation)
  title:    string;   // Short human-readable summary, stable across occurrences
  status:   number;   // HTTP status code, mirrored from the response line
  detail?:  string;   // Optional human-readable explanation for THIS occurrence
  instance?: string;  // Optional URI identifying THIS specific occurrence
  // Plus any number of extension members - like \`errors\` for field-level issues.
  [extension: string]: unknown;
}`;

const HTTP_ERROR_BASIC = `// src/routes/books.ts, throw, don't return.
import {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  TooManyRequestsError,
} from "@daloyjs/core";

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBook",
  params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  responses: { 200: { description: "ok" }, 404: { description: "not found" } },
  handler: async ({ params }) => {
    const book = await db.books.findUnique({ where: { id: params.id } });
    if (!book) throw new NotFoundError(\`No book with id \${params.id}\`);
    return { status: 200, body: book };
  },
});

// You never write \`return { status: 404, body: { error: "..." } }\`.
// You throw. The framework serializes it as RFC 9457 problem+json with
// the right status, the right Content-Type, and the right shape.`;

const ON_THE_WIRE_404 = `HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://daloyjs.dev/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "No book with id 0192a8b3-9c5f-71d7-9a07-e0c0baa3f97e"
}`;

const VALIDATION_ON_WIRE = `// Schema validation failure, automatic, no handler involvement.
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type": "https://daloyjs.dev/errors/validation",
  "title": "Request validation failed",
  "status": 422,
  "detail": "Invalid body",
  "errors": [
    { "path": "email",       "message": "must match format \\"email\\"" },
    { "path": "tags/0",      "message": "must be string" },
    { "path": "age",         "message": "must be >= 0" }
  ]
}`;

const VALIDATION_FRONTEND = `// apps/web/lib/api.ts, one helper, all errors.
import type { ProblemDetails } from "@daloyjs/core";

export async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);

  if (res.ok) return res.json() as Promise<T>;

  // application/problem+json is the contract. Trust it.
  const problem = (await res.json()) as ProblemDetails & {
    errors?: Array<{ path: string; message: string }>;
  };

  throw new ApiError(problem);
}

export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly fieldIssues: ReadonlyArray<{ path: string; message: string }>;

  constructor(public readonly problem: ProblemDetails & {
    errors?: Array<{ path: string; message: string }>;
  }) {
    super(problem.title);
    this.status = problem.status;
    this.type = problem.type;
    this.fieldIssues = problem.errors ?? [];
  }

  isValidation(): boolean {
    return this.type === "https://daloyjs.dev/errors/validation";
  }
  isRateLimited(): boolean {
    return this.type === "https://daloyjs.dev/errors/too-many-requests";
  }
}`;

const VALIDATION_FORM_USAGE = `// apps/web/components/book-form.tsx, react-hook-form, one render path.
async function onSubmit(values: BookFormValues) {
  try {
    await api("/books", { method: "POST", body: JSON.stringify(values) });
  } catch (err) {
    if (err instanceof ApiError && err.isValidation()) {
      // Map the framework's path strings into RHF errors. Generic.
      for (const issue of err.fieldIssues) {
        form.setError(issue.path as Path<BookFormValues>, { message: issue.message });
      }
      return;
    }
    if (err instanceof ApiError && err.isRateLimited()) {
      toast.warn("Slow down a little - try again in a moment.");
      return;
    }
    toast.error(err instanceof Error ? err.message : "Unknown error");
  }
}`;

const RATE_LIMIT_HEADER = `// Rate-limit example, note the response header, not just the body.
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 30

{
  "type": "https://daloyjs.dev/errors/too-many-requests",
  "title": "Too Many Requests",
  "status": 429
}

// The TooManyRequestsError constructor takes a retryAfterSeconds and the
// middleware attaches a real Retry-After header. Your retry-after-aware
// fetch helper (every team eventually writes one) just works:
//
//   throw new TooManyRequestsError(30);`;

const UNAUTHORIZED = `// Unauthorized vs Forbidden, the distinction nobody bothers with.
// The framework picks the right one; you just throw it.

// Endpoint behind bearerAuth, no token attached:
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json
WWW-Authenticate: Bearer realm="api"

{
  "type":  "https://daloyjs.dev/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Missing or invalid Bearer token"
}

// Endpoint behind CSRF with a missing token (you ARE logged in but the
// request can't be verified):
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type":  "https://daloyjs.dev/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "CSRF token missing or invalid"
}`;

const PRODUCTION_REDACTION = `# Production redaction in one line of framework code:
#
#   if (isProd && this.status >= 500) {
#     delete out.detail;
#   }
#
# What it looks like in practice:

# NODE_ENV=development
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json
{
  "type":   "https://daloyjs.dev/errors/internal",
  "title":  "Internal Server Error",
  "status": 500,
  "detail": "ENOENT: no such file or directory, open '/etc/secret-cache/abc'",
  "instance": "urn:request:01J2X3K6V0H8YEHMV7M2WD5XYJ"
}

# NODE_ENV=production (same error, same request id)
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json
{
  "type":   "https://daloyjs.dev/errors/internal",
  "title":  "Internal Server Error",
  "status": 500,
  "instance": "urn:request:01J2X3K6V0H8YEHMV7M2WD5XYJ"
}
# The detail is gone from the response. It's NOT gone from your logs -
# it's still there, correlated to the same urn:request: instance.`;

const LOG_CORRELATION = `// src/app.ts, the logger redacts NOTHING.
app.useOnError(async (err, ctx) => {
  if (err instanceof HttpError) {
    ctx.log.warn(
      {
        kind: "http-error",
        status: err.status,
        type: err.problem.type,
        detail: err.problem.detail,       // present even in prod
        requestId: ctx.requestId,         // matches problem.instance
        route: ctx.route?.operationId,
        userId: ctx.state.session?.id,
      },
      err.problem.title,
    );
  } else {
    ctx.log.error(
      { err, requestId: ctx.requestId, route: ctx.route?.operationId },
      "Unhandled error",
    );
  }
});

// In Datadog / Loki / Honeycomb you filter on requestId. The user gave you
// a screenshot of "Internal Server Error · urn:request:01J2X3..." - you
// paste that ULID into the log query and the full \`detail\` is right there.
// No more "can you reproduce it?".`;

const CUSTOM_ERROR_TYPE = `// src/errors/seat-unavailable.ts, your own domain error.
import { HttpError } from "@daloyjs/core";

export class SeatUnavailableError extends HttpError {
  constructor(detail: string) {
    super(409, {
      type: "https://booking.example.com/errors/seat-unavailable",
      title: "Seat unavailable",
      detail,
    });
    this.name = "SeatUnavailableError";
  }
}

// In your handler:
//   if (await isSeatTaken(seat)) {
//     throw new SeatUnavailableError(\`Seat \${seat} just got booked.\`);
//   }
//
// What the client sees:
// HTTP/1.1 409 Conflict
// Content-Type: application/problem+json
// {
//   "type":   "https://booking.example.com/errors/seat-unavailable",
//   "title":  "Seat unavailable",
//   "status": 409,
//   "detail": "Seat 17B just got booked."
// }
//
// The frontend can branch on type === "https://booking.example.com/errors/seat-unavailable"
// and trigger the "pick a different seat" flow. No new code in the framework.`;

const CONTRACT_TEST = `// tests/books.contract.test.ts, RFC 9457 makes contract tests trivial.
import { describe, it, expect } from "vitest";
import { runContractTests } from "@daloyjs/core/testing";
import { app } from "../src/app.ts";

it("getBook returns RFC 9457 on missing id", async () => {
  const res = await app.request("/books/does-not-exist");
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toBe("application/problem+json");

  const problem = await res.json();
  expect(problem).toMatchObject({
    type:   "https://daloyjs.dev/errors/not-found",
    title:  "Not Found",
    status: 404,
  });
});

// runContractTests(app) also asserts the shape automatically against the
// generated OpenAPI document, so a new error response in your handler
// can't escape into prod without showing up in the contract first.`;

const OPENAPI_HINT = `// generated/openapi.json, every response slot inherits the same schema.
{
  "components": {
    "responses": {
      "ProblemDetails": {
        "description": "Problem details (RFC 9457).",
        "content": {
          "application/problem+json": {
            "schema": { "$ref": "#/components/schemas/ProblemDetails" }
          }
        }
      }
    },
    "schemas": {
      "ProblemDetails": {
        "type": "object",
        "required": ["type", "title", "status"],
        "properties": {
          "type":     { "type": "string", "format": "uri" },
          "title":    { "type": "string" },
          "status":   { "type": "integer" },
          "detail":   { "type": "string" },
          "instance": { "type": "string", "format": "uri" }
        },
        "additionalProperties": true
      }
    }
  }
}
// Hey API's pnpm gen picks this up and your typed client gets a
// ProblemDetails type for every error response. Frontend autocompletes
// problem.type, problem.status, problem.detail. No more guessing.`;

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

/**
 * ErrorRow - single row of the built-in error catalogue.
 */
function ErrorRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: number;
  detail: string;
}) {
  return (
    <div className="not-prose my-3 flex flex-wrap items-baseline gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <Badge variant="outline" className="font-mono">
        {status}
      </Badge>
      <code className="font-mono text-sm">{name}</code>
      <p className="basis-full text-sm text-muted-foreground sm:flex-1 sm:basis-auto">
        {detail}
      </p>
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
            <Badge variant="outline">DX</Badge>
            <Badge variant="outline">API design</Badge>
            <Badge variant="outline">Standards</Badge>
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
            staring at a Slack message that says &quot;the API is throwing a
            weird error&quot; with a screenshot of a JSON blob whose shape I do
            not recognize. You&apos;ve had this conversation. Everyone has had
            this conversation. The frontend has to special-case three error
            formats from three teams, the mobile app gave up and shows{" "}
            <em>Something went wrong</em> for every non-2xx, and the on-call
            engineer is in there asking{" "}
            <em>
              which endpoint, can you re-send the request, what time exactly
            </em>
            {". "}Nobody is happy.
          </p>

          <p>
            That conversation has a fix, and it&apos;s twenty years old at this
            point: <strong>RFC 9457 Problem Details for HTTP APIs</strong> (the
            freshly-renamed successor to RFC 7807). One Content-Type, one
            document shape, one set of optional fields, and you can build
            <em>one</em> client-side error helper that works for every endpoint.
            DaloyJS uses it for every error response, not sometimes, every time,
            and this post is the tour.
          </p>

          <h2>Why the &quot;everyone invents their own&quot; pattern hurts</h2>

          <EditorFrame
            files={["the-status-quo.json"]}
            activeFile="the-status-quo.json"
            status="three teams · three shapes · zero shared client code"
          >
            <CodeBlock language="ts" code={BAD_OLD_WAY} />
          </EditorFrame>

          <p>
            That bottom panel is the actual cost. You can&apos;t write{" "}
            <em>one</em> <code>fetch</code> wrapper. Your TypeScript types for
            &quot;the error case&quot; are <code>unknown</code>
            {". "}Your telemetry pipeline can&apos;t group errors by type
            because there <em>is</em> no canonical type field. Every
            &quot;let&apos;s improve error handling&quot; refactor I&apos;ve
            been on in the last decade started here.
          </p>

          <h2>The contract: one document shape, forever</h2>

          <EditorFrame
            files={["@daloyjs/core · errors.ts"]}
            activeFile="@daloyjs/core · errors.ts"
            status="ProblemDetails, required core + open-ended extensions"
          >
            <CodeBlock language="ts" code={PROBLEM_DETAILS_SHAPE} />
          </EditorFrame>

          <p>
            That&apos;s it. Three required fields. Two optional. Anything else
            is an extension member you define yourself, and the framework uses{" "}
            <code>errors</code> as the conventional spot for field-level
            validation issues. The Content-Type{" "}
            <code>application/problem+json</code> tells the client (and any
            proxies in the middle) that this is a problem document, not a domain
            success response that happens to be JSON-shaped.
          </p>

          <h2>The handler experience: throw, don&apos;t return</h2>

          <p>
            The single biggest ergonomic win is that you write your handlers in
            terms of <em>successful</em> responses only. Anything that goes
            wrong, you <code>throw</code>
            {". "}The framework does the rest.
          </p>

          <EditorFrame
            files={["src/routes/books.ts"]}
            activeFile="src/routes/books.ts"
            status="throw NotFoundError(...), never return a 404 by hand"
          >
            <CodeBlock language="ts" code={HTTP_ERROR_BASIC} />
          </EditorFrame>

          <EditorFrame
            files={["GET /books/0192a8b3- · raw response"]}
            activeFile="GET /books/0192a8b3- · raw response"
            status="application/problem+json · the type URI is a stable identifier"
          >
            <CodeBlock language="http" code={ON_THE_WIRE_404} />
          </EditorFrame>

          <h2>The built-in error catalogue</h2>

          <p>
            The framework ships an HttpError subclass for every status code you
            actually use. You import the one you want and throw it. Status,
            title, type URI, and headers, handled.
          </p>

          <ErrorRow
            name="HttpError"
            status={0}
            detail="Base class, instantiate directly only for unusual status codes or fully-custom problem documents."
          />
          <ErrorRow
            name="BadRequestError"
            status={400}
            detail="The request is syntactically invalid in a way the client can fix without retrying."
          />
          <ErrorRow
            name="UnauthorizedError"
            status={401}
            detail="Authentication is required and missing or invalid. Pair with WWW-Authenticate on the response."
          />
          <ErrorRow
            name="ForbiddenError"
            status={403}
            detail="Authenticated but not permitted. Used by built-in CSRF and bearer-token middleware."
          />
          <ErrorRow
            name="NotFoundError"
            status={404}
            detail="Resource doesn't exist. Also thrown internally for unmatched routes."
          />
          <ErrorRow
            name="MethodNotAllowedError"
            status={405}
            detail="Path matched but method didn't. Includes Allow header automatically."
          />
          <ErrorRow
            name="RequestTimeoutError"
            status={408}
            detail="Handler exceeded App.requestTimeoutMs. Framework aborts the in-flight handler."
          />
          <ErrorRow
            name="PayloadTooLargeError"
            status={413}
            detail="Body exceeded the configured size cap. Stops parsing early."
          />
          <ErrorRow
            name="UnsupportedMediaTypeError"
            status={415}
            detail="Content-Type doesn't match what the route declared in its schema."
          />
          <ErrorRow
            name="ValidationError"
            status={422}
            detail="Schema validation failed. Auto-thrown by the request validator. Carries an errors array of {path, message}."
          />
          <ErrorRow
            name="TooManyRequestsError"
            status={429}
            detail="Rate-limited. Optional retryAfterSeconds becomes a Retry-After header."
          />
          <ErrorRow
            name="InternalError"
            status={500}
            detail="Last-resort wrap for unhandled exceptions. Detail is redacted in production."
          />

          <h2>ValidationError: the one you&apos;ll see most</h2>

          <p>
            You don&apos;t throw <code>ValidationError</code> by hand most of
            the time, the framework throws it for you the moment a request body,
            params, query, or headers fail their declared schema. It carries an{" "}
            <code>errors</code> array of{" "}
            <code>&#123; path, message &#125;</code> records, which is the shape
            every form library on the planet expects.
          </p>

          <EditorFrame
            files={["POST /books · invalid body"]}
            activeFile="POST /books · invalid body"
            status="422 · errors[] with JSON-pointer-ish paths"
          >
            <CodeBlock language="http" code={VALIDATION_ON_WIRE} />
          </EditorFrame>

          <p>
            On the frontend, the entire universe of error handling reduces to{" "}
            <em>one</em> helper:
          </p>

          <EditorFrame
            files={["apps/web/lib/api.ts"]}
            activeFile="apps/web/lib/api.ts"
            status="one helper · every endpoint · ProblemDetails-typed"
          >
            <CodeBlock language="ts" code={VALIDATION_FRONTEND} />
          </EditorFrame>

          <EditorFrame
            files={["apps/web/components/book-form.tsx"]}
            activeFile="apps/web/components/book-form.tsx"
            status="react-hook-form · setError(path, message) · done"
          >
            <CodeBlock language="ts" code={VALIDATION_FORM_USAGE} />
          </EditorFrame>

          <h2>The rate-limit story (Retry-After done correctly)</h2>

          <p>
            <code>TooManyRequestsError</code> takes an optional{" "}
            <code>retryAfterSeconds</code> argument. The framework turns it into
            a real <code>Retry-After</code> header on the response, so your
            retry-after-aware fetch helper doesn&apos;t need to re-parse the
            body to figure out how long to back off:
          </p>

          <EditorFrame
            files={["HTTP/1.1 429 · response"]}
            activeFile="HTTP/1.1 429 · response"
            status="Retry-After header + problem+json body, both correct"
          >
            <CodeBlock language="http" code={RATE_LIMIT_HEADER} />
          </EditorFrame>

          <h2>Unauthorized vs Forbidden, sorted</h2>

          <p>
            Whoever named these two status codes did the field a disservice.
            <em>Unauthorized</em> means &quot;we don&apos;t know who you
            are&quot; (a.k.a. unauthenticated). <em>Forbidden</em> means
            &quot;we know who you are; you can&apos;t do this&quot;. The
            framework picks the right one based on which middleware triggered
            it, and your bearerAuth automatically attaches the
            <code>WWW-Authenticate</code> challenge:
          </p>

          <EditorFrame
            files={["HTTP/1.1 401 · then HTTP/1.1 403"]}
            activeFile="HTTP/1.1 401 · then HTTP/1.1 403"
            status="bearerAuth → 401 + WWW-Authenticate · csrf() → 403"
          >
            <CodeBlock language="http" code={UNAUTHORIZED} />
          </EditorFrame>

          <h2>Production redaction: leak nothing, log everything</h2>

          <p>
            One of my favorite quiet features of the error layer is the 5xx
            redaction rule. When <code>NODE_ENV=production</code>
            {", "}any error with status ≥ 500 has its <code>detail</code> field{" "}
            <em>stripped from the response</em> before it leaves the server. The
            user gets the type, the title, the status, and a request-id-shaped{" "}
            <code>instance</code>
            {": "}enough to file a support ticket. The server logs keep the
            full detail.
          </p>

          <EditorFrame
            files={["NOTES.md"]}
            activeFile="NOTES.md"
            status="dev vs prod · same code path · different exposure"
          >
            <CodeBlock language="bash" code={PRODUCTION_REDACTION} />
          </EditorFrame>

          <EditorFrame
            files={["src/app.ts"]}
            activeFile="src/app.ts"
            status="logger sees everything · response sees nothing extra"
          >
            <CodeBlock language="ts" code={LOG_CORRELATION} />
          </EditorFrame>

          <p>
            The <code>urn:request:&lt;ULID&gt;</code> instance is the single
            most useful thing on a production error page. The user gives you
            that ULID; you paste it into Datadog or Loki; the full stack and
            detail come back. The customer-facing message stays useless to
            attackers and helpful to humans. Both win.
          </p>

          <h2>Your own domain errors are five lines</h2>

          <p>
            Anything more specific than the built-in catalogue is a five-line
            subclass. The framework cares about the status code and the document
            shape; everything else is yours. Use a URI you own for the{" "}
            <code>type</code> so the frontend can branch on it without parsing
            strings:
          </p>

          <EditorFrame
            files={["src/errors/seat-unavailable.ts"]}
            activeFile="src/errors/seat-unavailable.ts"
            status="domain error · stable type URI · throws like a built-in"
          >
            <CodeBlock language="ts" code={CUSTOM_ERROR_TYPE} />
          </EditorFrame>

          <h2>Contract tests: cheap because the shape is fixed</h2>

          <p>
            The single most boring sentence in this post: when every error
            response is the same shape, asserting against errors is{" "}
            <em>trivial</em>
            {". "}There&apos;s nothing to special-case. A contract test for
            &quot;this endpoint returns a 404 for a missing id&quot; is six
            lines:
          </p>

          <EditorFrame
            files={["tests/books.contract.test.ts"]}
            activeFile="tests/books.contract.test.ts"
            status="content-type assert · type URI assert · status assert"
          >
            <CodeBlock language="ts" code={CONTRACT_TEST} />
          </EditorFrame>

          <p>
            And because <code>generateOpenAPI(app)</code> emits a single{" "}
            <code>ProblemDetails</code> schema that every error response
            references, the typed-client codegen produces one matching
            TypeScript type. The frontend autocompletes{" "}
            <code>problem.type</code>
            {", "}<code>problem.detail</code>
            {", "}
            <code>problem.errors</code>
            {". "}No drift between the docs, the wire format, and the types,
            they are literally the same source.
          </p>

          <EditorFrame
            files={["generated/openapi.json"]}
            activeFile="generated/openapi.json"
            status="one ProblemDetails schema · every error response refs it"
          >
            <CodeBlock language="json" code={OPENAPI_HINT} />
          </EditorFrame>

          <h2>One paragraph of honest caveats</h2>

          <p>
            Problem Details isn&apos;t a magic protocol, it&apos;s a promise
            about response shape. It does nothing if you bypass it and return
            your own ad-hoc JSON from a handler (please don&apos;t). It does
            nothing for non-JSON error pages from upstream proxies (your
            CDN&apos;s 502 HTML is still HTML; deal with it in the client). And
            the <code>type</code> URI is a <em>stable identifier</em>
            {", "}not a link the client necessarily dereferences, treat it like
            an enum value. Beyond those: it&apos;s the closest thing to a free
            lunch the HTTP standards world has given us in years.
          </p>

          <h2>Where to go next</h2>

          <p>
            The full reference for every built-in error class is in the{" "}
            <Link href="/docs/errors">errors docs</Link>
            {". "}If you&apos;re still wiring up the surrounding pieces, typed
            client, sessions, rate limiting, the{" "}
            <Link href="/blog/contract-first-without-the-codegen-dance">
              contract-first
            </Link>{" "}
            and <Link href="/blog/sessions-on-the-edge">sessions</Link> posts
            are the closest neighbors in spirit.
          </p>

          <p>
            Thanks for reading. Now go open the <code>fetch</code> wrapper in
            your frontend and count how many error shapes it knows about.
            Whatever the number is, the target is one.
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
              <Link
                href="/docs/errors"
                className="underline underline-offset-4"
              >
                Read the errors docs
              </Link>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Link
                href="/blog/contract-first-without-the-codegen-dance"
                className="underline underline-offset-4"
              >
                Contract-first post
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
