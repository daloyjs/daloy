import { CodeBlock } from "../../../components/code-block";
import { FlowDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Pagination & cursor helpers",
  description:
    "Paginate list endpoints with the built-in, dependency-free cursor helpers: opaque base64url cursor encode/decode, RFC 8288 Link header emission, and a paginationQuery() Standard Schema that validates the cursor + limit query parameters and wires them into the generated OpenAPI document and typed client.",
  path: "/docs/pagination",
  keywords: [
    "cursor pagination",
    "opaque cursor",
    "Link header",
    "RFC 8288",
    "DaloyJS paginationQuery",
    "encodeCursor",
    "decodeCursor",
    "OpenAPI parameters",
    "limit query parameter",
    "keyset pagination",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Pagination &amp; cursor helpers</h1>
      <p>
        List endpoints need a way to page through results that is stable under
        concurrent writes, cheap on the database, and self-describing in the
        contract. DaloyJS ships <strong>built-in, dependency-free</strong>{" "}
        cursor-pagination helpers that cover all three concerns: an{" "}
        <strong>opaque cursor</strong> codec, an{" "}
        <strong>
          RFC 8288 <code>Link</code> header
        </strong>{" "}
        builder, and a <code>paginationQuery()</code> Standard Schema that
        validates the <code>cursor</code> / <code>limit</code> query parameters{" "}
        <em>and</em> wires them into the generated OpenAPI document and typed
        client.
      </p>
      <p>
        Everything is built on Web-standard <code>URL</code>, <code>btoa</code>{" "}
        / <code>atob</code>, and <code>JSON</code>, so it runs unchanged on
        Node, Bun, Deno, Cloudflare Workers, and Vercel.
      </p>

      <FlowDiagram
        title="One page of a cursor-paginated list"
        numbered
        steps={[
          {
            eyebrow: "validate",
            label: "paginationQuery()",
            detail: "typed { limit, cursor }",
          },
          {
            eyebrow: "decode",
            label: "decodeCursor()",
            detail: "opaque token to sort key",
          },
          {
            eyebrow: "query",
            label: "Fetch limit + 1 rows",
            detail: "one extra row reveals next page",
            tone: "accent",
          },
          {
            eyebrow: "encode",
            label: "encodeCursor(last row)",
            detail: "next cursor or null",
          },
          {
            eyebrow: "advertise",
            label: "buildPageLinks() Link header",
            detail: "rel=next · prev · first",
            tone: "success",
          },
        ]}
        caption="paginationQuery() validates and coerces the limit and cursor query params, decodeCursor() turns the opaque token back into a sort key, and fetching limit + 1 rows reveals whether another page exists. The last row becomes the next cursor, advertised through an RFC 8288 Link header."
      />

      <h2>Quick start</h2>
      <p>
        Mount <code>paginationQuery()</code> as the route&apos;s{" "}
        <code>request.query</code>. The handler receives a fully typed,
        validated <code>{`{ limit, cursor }`}</code>; build the next cursor from
        the last row and advertise it with a <code>Link</code> header.
      </p>
      <CodeBlock
        code={`import {
  App,
  paginationQuery,
  encodeCursor,
  decodeCursor,
  buildPageLinks,
} from "@daloyjs/core";

const app = new App();

app.route({
  method: "GET",
  path: "/books",
  operationId: "listBooks",
  request: { query: paginationQuery({ defaultLimit: 25, maxLimit: 100 }) },
  responses: { 200: { description: "ok" } },
  handler: async ({ query, request, set }) => {
    const { limit, cursor } = query; // typed + validated
    const after = cursor ? decodeCursor<{ id: number }>(cursor).id : 0;

    // Fetch limit + 1 to know whether another page exists.
    const rows = await db.books.findMany({
      where: { id: { gt: after } },
      orderBy: { id: "asc" },
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const next =
      rows.length > limit
        ? encodeCursor({ id: page[page.length - 1].id })
        : null;

    const { linkHeader } = buildPageLinks({ url: request.url, next });
    if (linkHeader) set.headers.set("Link", linkHeader);

    return { status: 200 as const, body: { items: page } };
  },
});`}
        language="ts"
      />

      <h2>Opaque cursors</h2>
      <p>
        <code>encodeCursor()</code> serializes any JSON-serializable value
        (typically the sort key of the last row) into a compact, URL-safe
        base64url token. <code>decodeCursor()</code> reverses it.
      </p>
      <CodeBlock
        code={`const cursor = encodeCursor({ id: 42, createdAt: "2026-05-31T00:00:00.000Z" });
// "eyJpZCI6NDIsImNyZWF0ZWRBdCI6IjIwMjYtMDUtMzFUMDA6MDA6MDAuMDAwWiJ9"

const payload = decodeCursor<{ id: number; createdAt: string }>(cursor);
// { id: 42, createdAt: "2026-05-31T00:00:00.000Z" }`}
        language="ts"
      />
      <p>
        Decoding is hardened: the input is capped at{" "}
        <code>MAX_CURSOR_LENGTH</code> (4&nbsp;KiB), malformed base64url and
        invalid JSON are rejected, and any <code>__proto__</code> /{" "}
        <code>constructor</code> / <code>prototype</code> keys in the decoded
        graph are stripped (prototype-pollution defense). A tampered cursor
        surfaces as a <code>400 Bad Request</code>, not a <code>500</code>.
      </p>
      <CodeBlock
        code={`try {
  decodeCursor(untrustedCursor);
} catch (err) {
  // BadRequestError -> 400 problem+json
}`}
        language="ts"
      />

      <h2>RFC 8288 Link header</h2>
      <p>
        <code>buildPageLinks()</code> clones the current request URL and swaps
        its cursor query parameter to produce <code>next</code>,{" "}
        <code>prev</code>, and <code>first</code> page URLs, preserving every
        other query parameter (filters, <code>limit</code>, …), then serializes
        them into a single <code>Link</code> header.
      </p>
      <CodeBlock
        code={`const { links, linkHeader, urls } = buildPageLinks({
  url: request.url,
  next: nextCursor,
  prev: prevCursor,
  first: true,
});

// linkHeader:
//   <https://api.example.com/books?cursor=NEXT>; rel="next",
//   <https://api.example.com/books?cursor=PREV>; rel="prev",
//   <https://api.example.com/books>; rel="first"

set.headers.set("Link", linkHeader);
// urls.next / urls.prev / urls.first are also available for a JSON body.`}
        language="ts"
      />
      <p>
        Need lower-level control? <code>buildLinkHeader()</code> serializes an
        explicit list of <code>{`{ url, rel, title? }`}</code> entries. Both
        builders reject control characters, <code>&lt;</code>/<code>&gt;</code>{" "}
        in URLs, and <code>&quot;</code>/<code>\\</code> in rel/title values: a
        structural defense against <code>Link</code>-header / response-splitting
        injection.
      </p>

      <h2>OpenAPI parameter wiring</h2>
      <p>
        Because <code>paginationQuery()</code> exposes a{" "}
        <code>toJSONSchema()</code> method, the OpenAPI generator emits the{" "}
        <code>cursor</code> and <code>limit</code> query parameters into the
        contract automatically, with no duplicate parameter declarations, and
        the typed client picks them up on the next <code>pnpm gen</code>.
      </p>
      <CodeBlock
        code={`// Generated for GET /books:
// parameters:
//   - in: query
//     name: limit
//     schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
//   - in: query
//     name: cursor
//     schema: { type: string, maxLength: 4096 }`}
        language="yaml"
      />
      <p>
        At runtime the same schema coerces <code>limit</code> from its string
        query value to an integer and rejects out-of-range or non-integer values
        at the request boundary with a <code>422</code>. Customize the parameter
        names and bounds:
      </p>
      <CodeBlock
        code={`paginationQuery({
  cursorParam: "after",   // default "cursor"
  limitParam: "perPage",  // default "limit"
  defaultLimit: 20,        // default min(20, maxLimit)
  minLimit: 1,             // default 1
  maxLimit: 100,           // default 100
});`}
        language="ts"
      />

      <h2>Security notes</h2>
      <ul>
        <li>
          Cursors are <strong>opaque, not secret</strong>: they are encoded, not
          encrypted or signed. Never trust a decoded cursor for authorization;
          always re-scope the underlying query by the authenticated principal on
          the server.
        </li>
        <li>
          <code>decodeCursor()</code> caps input length, rejects malformed
          tokens, and strips prototype-pollution keys, so a hostile cursor
          cannot crash the handler or poison object prototypes.
        </li>
        <li>
          The <code>Link</code> builders reject CRLF, angle brackets, and quote
          characters, preventing header-injection through computed URLs or
          titles.
        </li>
        <li>
          <code>maxLimit</code> bounds the page size a client can request,
          protecting the database from unbounded scans.
        </li>
      </ul>
    </>
  );
}
