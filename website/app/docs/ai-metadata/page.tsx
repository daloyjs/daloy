import Link from "next/link";

import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "AI-friendly route metadata",
  description:
    "Author machine-readable usage examples on DaloyJS routes. Examples are validated against your Standard Schemas at build time and surfaced into OpenAPI for Hey API and LLM codegen tooling.",
  path: "/docs/ai-metadata",
  keywords: [
    "DaloyJS meta",
    "OpenAPI examples",
    "LLM codegen",
    "Hey API examples",
    "daloy inspect --ai",
    "routes.json",
    "machine-readable API contract",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>AI-friendly route metadata</h1>
      <p>
        Pass an optional <code>meta</code> field on any <code>route()</code>{" "}
        call to attach <strong>structured usage examples</strong>, extra
        descriptive copy, or free-form <code>x-*</code> extensions. Daloy
        validates every example against your route&rsquo;s Standard Schema at
        build time and emits the same payload into OpenAPI (
        <code>examples</code> on the request body, <code>examples</code> on the
        matching response, <code>x-daloy-examples</code> on the operation) and
        into the <code>daloy inspect --ai</code> dump that codegen agents and
        SDK builders consume.
      </p>

      <p>
        <strong>Additive and non-breaking.</strong> Existing routes keep working
        unchanged, <code>meta</code> is optional everywhere.
      </p>

      <BranchDiagram
        title="One meta block, many consumers"
        source={{
          eyebrow: "single source",
          label: "route({ meta })",
          detail: "examples, description, x-* extensions",
        }}
        branches={[
          {
            eyebrow: "build time",
            label: "Schema validation",
            detail: "every example checked vs Standard Schema",
          },
          {
            eyebrow: "spec",
            label: "OpenAPI 3.1",
            detail: "examples + x-daloy-examples on the operation",
          },
          {
            eyebrow: "agents",
            label: "daloy inspect --ai",
            detail: "routes.json / routes.yaml dump",
          },
          {
            eyebrow: "codegen",
            label: "Hey API + LLM tooling",
            detail: "examples carry into SDK docstrings",
          },
        ]}
        caption="The meta block is the one place you author examples. Daloy validates them against your schemas, then surfaces the same payload into OpenAPI and the AI dump that codegen agents consume."
      />

      <h2>Author examples</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const app = new App();

const Book = z.object({ id: z.string(), title: z.string() });

app.route({
  method: "POST",
  path: "/books",
  operationId: "createBook",
  tags: ["Books"],
  request: { body: z.object({ title: z.string().min(1) }) },
  responses: {
    201: { description: "Created", body: Book },
    400: { description: "Invalid" },
  },
  meta: {
    description: "Create a book record.",
    tags: ["AI"],
    examples: {
      happy: {
        summary: "Standard create",
        request: { body: { title: "Dune" } },
        response: { status: 201, body: { id: "1", title: "Dune" } },
      },
      missingTitle: {
        summary: "Validation failure",
        request: { body: { title: "" } },
        response: { status: 400 },
      },
    },
    extensions: {
      "x-codegen-hint": "books-table",
    },
  },
  handler: async ({ body }) => ({
    status: 201 as const,
    body: { id: crypto.randomUUID(), title: body.title },
  }),
});`}
      />

      <h2>Shape of a meta block</h2>
      <ul>
        <li>
          <code>summary</code> / <code>description</code> / <code>tags</code>: 
          augment the route-level fields of the same name. Route-level values
          win when both are set; tags are de-duplicated and concatenated.
        </li>
        <li>
          <code>examples</code>: record of named{" "}
          <code>{`{ summary?, description?, request?: { params?, query?, headers?, body? }, response?: { status, body?, headers? } }`}</code>{" "}
          pairs. Every field is optional individually; pass only the parts you
          want documented.
        </li>
        <li>
          <code>extensions</code>: free-form bag emitted onto the OpenAPI
          Operation Object. Keys without an <code>x-</code> prefix are prefixed
          automatically for spec compliance.
        </li>
      </ul>

      <h2>Build-time validation</h2>
      <p>
        Run <code>pnpm daloy inspect --check</code> (or call{" "}
        <code>runContractTests(app)</code> from your tests). For every named
        example, Daloy validates:
      </p>
      <ul>
        <li>
          <code>request.body</code> / <code>request.query</code> /{" "}
          <code>request.params</code> / <code>request.headers</code> against the
          matching schema on <code>request</code> when both sides exist.
        </li>
        <li>
          <code>response.body</code> against the response schema for the
          declared <code>status</code>; an unknown status code is itself an
          error.
        </li>
      </ul>
      <p>
        Mismatches fail the contract run so the OpenAPI document never publishes
        a sample that does not match its schema.
      </p>

      <h2>OpenAPI surfacing</h2>
      <p>
        The same shape is folded into the generated OpenAPI 3.1 document so
        Swagger UI, Scalar, and Hey API see your examples without any extra
        wiring:
      </p>
      <CodeBlock
        language="json"
        code={`{
  "paths": {
    "/books": {
      "post": {
        "operationId": "createBook",
        "tags": ["Books", "AI"],
        "x-codegen-hint": "books-table",
        "x-daloy-examples": { "happy": { /* ... */ } },
        "requestBody": {
          "content": {
            "application/json": {
              "schema": { "type": "object", "properties": { "title": { "type": "string" } } },
              "examples": {
                "happy": { "summary": "Standard create", "value": { "title": "Dune" } }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": { "$ref": "..." },
                "examples": {
                  "happy": { "summary": "Standard create", "value": { "id": "1", "title": "Dune" } }
                }
              }
            }
          }
        }
      }
    }
  }
}`}
      />

      <h2>
        <code>daloy inspect --ai</code>
      </h2>
      <p>
        Dump the whole route catalog, with JSON Schema for every input and
        output and every <code>meta.examples</code> entry, as a single,
        self-describing JSON document. It is the format Daloy recommends for
        feeding to an LLM or a codegen agent that needs more than the OpenAPI
        spec alone:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm daloy inspect --ai > routes.json
pnpm daloy inspect --ai --json | jq '.routes[].operationId'

# Emit YAML instead of JSON - typically ~30% smaller, which matters
# when you are pasting the dump into an LLM system prompt.
pnpm daloy inspect --ai --yaml > routes.yaml
pnpm daloy inspect --ai --format yaml > routes.yaml

# Combine with --tag/--method to scope the dump
pnpm daloy inspect --ai --tag Books`}
      />

      <p>Output shape:</p>
      <CodeBlock
        language="json"
        code={`{
  "daloy": { "ai": 1 },
  "generatedAt": "2026-05-19T12:00:00.000Z",
  "routeCount": 1,
  "routes": [
    {
      "method": "POST",
      "path": "/books",
      "operationId": "createBook",
      "tags": ["Books", "AI"],
      "request":  { "body": { /* JSON Schema */ } },
      "responses": {
        "201": { "description": "Created", "body": { /* JSON Schema */ } },
        "400": { "description": "Invalid" }
      },
      "examples": { "happy": { /* same shape you authored */ } },
      "extensions": { "x-codegen-hint": "books-table" }
    }
  ]
}`}
      />

      <h2>YAML output</h2>
      <p>
        Both <code>--ai</code> and <code>--openapi</code> accept{" "}
        <code>--yaml</code> (shorthand) or <code>--format yaml</code>. The
        emitter is a tiny built-in YAML 1.2 serializer with no runtime
        dependencies. Because YAML drops braces, commas, and most quotes, the
        dump is typically <strong>about 30% smaller</strong> than the equivalent
        pretty-printed JSON, a meaningful saving when the file becomes part of
        an LLM system prompt.
      </p>
      <CodeBlock
        language="yaml"
        code={`daloy:
  ai: 1
generatedAt: "2026-05-19T12:00:00.000Z"
routeCount: 1
routes:
  - method: POST
    path: /books
    operationId: createBook
    tags:
      - Books
      - AI
    request:
      body:
        type: object
        properties:
          title:
            type: string
        required:
          - title
    responses:
      "201":
        description: Created
        body:
          type: object
          properties:
            id: { type: string }
            title: { type: string }
      "400":
        description: Invalid
    examples:
      happy:
        summary: Standard create
        request:
          body:
            title: Dune
        response:
          status: 201
          body:
            id: "1"
            title: Dune
    extensions:
      x-codegen-hint: books-table`}
      />
      <p>
        Use JSON when piping to <code>jq</code> or any other JSON-only tool, and
        YAML when humans or LLMs will read the file directly.
      </p>

      <h2>Consuming the dump</h2>
      <p>
        The dump is intentionally a flat JSON file with no DaloyJS runtime
        coupling. Feed it directly to:
      </p>
      <ul>
        <li>
          <Link href="/docs/typed-client">Hey API codegen</Link> as a sibling
          artifact: the <code>examples</code> map carries through to the
          generated SDK&rsquo;s docstrings.
        </li>
        <li>
          An LLM (Claude / GPT / Gemini) as part of a system prompt for “write
          me a fetch call that hits the books endpoint”.
        </li>
        <li>
          A custom code generator (Python client, Go SDK, Postman collection), 
          every field is plain JSON.
        </li>
      </ul>

      <p>
        Pair this page with the <Link href="/docs/cli">CLI inspector</Link>{" "}
        guide and the <Link href="/docs/openapi">OpenAPI generation</Link> guide
        for the broader contract-first picture.
      </p>
    </>
  );
}
