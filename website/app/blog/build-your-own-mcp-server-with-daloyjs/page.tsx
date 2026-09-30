import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "build-your-own-mcp-server-with-daloyjs",
  title: "Build Your Own MCP Server on DaloyJS, and Why It Refuses to Run Without Auth",
  description:
    "Turn your API into tools an AI assistant can call, with createMcpHandler() and mcpRoutes(). No MCP SDK, no extra dependency, and a production app that fails closed if you forget the auth.",
  date: "2026-09-30",
  readingTime: "8 min read",
  author: "Devlin Duldulao",
  authorRole: "software engineer & published book author",
  authorBio:
    "Filipino fullstack developer in Norway. Has spent around 12 years building APIs for humans, and has now accepted that the most frequent caller of his APIs will be a language model that never reads the docs but somehow still has opinions about them.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "MCP server",
    "Model Context Protocol",
    "build an MCP server",
    "MCP TypeScript",
    "MCP server authentication",
    "Streamable HTTP MCP",
    "MCP tools API",
    "DaloyJS MCP",
    "MCP vs A2A",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const SERVER = `import {
  App,
  McpToolError,
  bearerAuth,
  createMcpHandler,
  mcpRoutes,
  rateLimit,
  timingSafeEqual,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const mcp = createMcpHandler({
  serverInfo: { name: "inventory-mcp", version: "1.0.0" },
  instructions: "Look up stock levels for Acme products.",
  tools: [
    {
      name: "inventory_lookup",
      description: "Units on hand for one SKU.",
      inputSchema: {
        type: "object",
        properties: { sku: { type: "string", minLength: 1 } },
        required: ["sku"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      handler: async (args) => {
        const sku = String(args.sku);
        const units = await inventory.unitsFor(sku);
        if (units === 0) throw new McpToolError(\`Unknown SKU \${sku}.\`);
        return {
          content: [{ type: "text", text: \`\${sku}: \${units} units\` }],
          structuredContent: { sku, units },
        };
      },
    },
  ],
});

const app = new App();
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
app.use(bearerAuth({ validate: (token) => timingSafeEqual(token, process.env.MCP_TOKEN!) }));
for (const route of mcpRoutes("/mcp", mcp)) app.route(route);

serve(app, { port: 3001 });`;

const CLIENT_CONFIG = `{
  "mcpServers": {
    "inventory": {
      "url": "https://mcp.acme.example/mcp",
      "headers": { "Authorization": "Bearer \${MCP_TOKEN}" }
    }
  }
}`;

const SCHEMA_ERROR = `// The model "helpfully" adds an argument you never declared:
{ "name": "inventory_lookup", "arguments": { "sku": "ACME-1", "drop": "table" } }

// Your handler never runs. The model gets this back instead:
{
  "code": -32602,
  "message": "Invalid arguments for tool \\"inventory_lookup\\": arguments.drop: unexpected property (additionalProperties is false)"
}`;

const BOOT_GUARD = `MCP route POST /mcp (from mcpRoutes()) has no authentication hook in its
effective hook chain. MCP tools are model-controlled and can trigger side
effects, so an unauthenticated endpoint is a high-impact default. Install an
auth middleware covering the MCP route (e.g. app.use(bearerAuth({ ... }))),
wrap a custom auth hook with markAuthHook(...), pass
mcpRoutes(path, handler, { public: true }) to intentionally expose it, ...`;

const ASK_FIRST = `// Excerpt: a tool that pauses to ask the human before deploying.
if (!ctx.inputResponses?.confirm) {
  return {
    resultType: "input_required",
    inputRequests: { confirm: { method: "elicitation/create", params: { /* ... */ } } },
    // This comes back through the client. Treat it as attacker-controlled:
    // sign it, bind it to the user and the target, and give it an expiry.
    requestState: await signState({ sub: userId, service: args.service, exp: Date.now() + 120_000 }),
  };
}`;

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

export default function BlogPostPage() {
  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-6 py-16 lg:py-20">
        <header className="not-prose mb-10">
          <Link
            href="/blog"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            &lt;- Back to blog
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">MCP</Badge>
            <Badge variant="outline">AI agents</Badge>
            <Badge variant="outline">Security</Badge>
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
            Two days ago I wrote about{" "}
            <Link href={"/blog/your-api-can-now-be-an-a2a-agent" as Route}>
              A2A
            </Link>
            , and in the first paragraph I casually said DaloyJS &quot;answered&quot;
            the MCP question with its built-in server. Then I went to link the
            blog post about it and found out there was none. I wrote the feature,
            wrote a very long docs page, and apparently forgot to tell anyone.
            Classic developer marketing strategy. So here it is.
          </p>

          <p>
            The short version: if you want an AI assistant like Claude, Cursor or
            Copilot to use your API, you give it an MCP server. DaloyJS ships one
            in core. You describe your tools, mount one route, and your existing
            auth, rate limits and validation apply to the model exactly like they
            apply to everybody else.
          </p>

          <h2>MCP in one paragraph</h2>

          <p>
            The Model Context Protocol is how an AI client discovers and calls
            tools. Your server lists tools with a name, a description and a JSON
            Schema for the input. The model reads that list, decides which tool
            fits, and calls it with arguments. You run the tool and send back
            text and structured data. That is the whole idea. The rest is making
            sure the model can only do what you meant it to do.
          </p>

          <FlowDiagram
            title="One tool call, end to end"
            numbered
            steps={[
              { label: "AI client", detail: "POST /mcp tools/call", tone: "default" },
              { label: "Your middleware", detail: "auth + rate limit", tone: "accent" },
              { label: "createMcpHandler()", detail: "origin, headers, inputSchema", tone: "default" },
              { label: "Your tool", detail: "validated args only", tone: "success" },
            ]}
            caption="The model never reaches your handler without passing the same auth and rate limits as a human caller, and arguments that do not match the declared inputSchema are refused before your code runs."
          />

          <h2>What it looks like</h2>

          <p>
            <code>createMcpHandler()</code> is the protocol layer.{" "}
            <code>mcpRoutes()</code> turns it into normal DaloyJS routes, so it
            sits behind the same middleware as the rest of your app. This is a
            complete, runnable server:
          </p>

          <CodeBlock code={SERVER} />

          <p>
            A few things are doing more work than they look. The{" "}
            <code>inputSchema</code> is not just documentation for the model, it
            is enforced (more on that below). <code>readOnlyHint</code> tells the
            client this tool does not change anything, which a client can use
            when it decides whether to ask the user before calling it. And{" "}
            <code>McpToolError</code> sends the model a readable tool error
            instead of a stack trace, so it can say &quot;that SKU does not
            exist&quot; instead of inventing stock numbers. Models already invent
            enough.
          </p>

          <p>Then point any MCP client at it:</p>

          <CodeBlock code={CLIENT_CONFIG} language="json" />

          <h2>No SDK, no extra dependency</h2>

          <p>
            DaloyJS does not wrap the official MCP SDK. The protocol is
            implemented in core, and <code>@daloyjs/core</code> still has zero
            runtime dependencies. I care about this more than is probably healthy,
            but every dependency is one more thing that can get a malicious
            release on a Friday night.
          </p>

          <p>
            It also means the server speaks the current spec, MCP{" "}
            <code>2026-07-28</code>, which removed the old session handshake.
            Every request now carries its own protocol version and client
            capabilities, so any request can land on any instance. That is the
            exact shape serverless and edge platforms want, and it is the shape
            DaloyJS was built for. Older clients still work on the same endpoint:
            the server picks the protocol era from what the client declares.
          </p>

          <p>
            That dual-era support is also where a lazy implementation gets
            burned. If a gateway in front of your server routes on the MCP
            headers, an attacker could declare an old protocol version, keep the
            headers the gateway likes, and send a body that does something else.
            DaloyJS checks that the headers and the body agree in both eras, and
            refuses the request when they do not.
          </p>

          <h2>Secure by default, because the caller is a model</h2>

          <p>
            A tool call looks like an API request, but the thing deciding to make
            it is a language model that can be talked into things by whatever
            text it read last. So the MCP endpoint gets stricter defaults than a
            normal route:
          </p>

          <ul>
            <li>
              <strong>No auth, no service.</strong> In a production app with{" "}
              <code>secureDefaults</code> (the default), an MCP route without an
              auth hook fails closed. Every request gets a 500, and your logs get
              an error that tells you exactly how to fix it. A genuinely public
              MCP server has to say so with{" "}
              <code>mcpRoutes(path, handler, {"{ public: true }"})</code>.
            </li>
            <li>
              <strong>DNS rebinding is blocked.</strong> A malicious web page can
              trick a browser into calling a server on your machine or your
              network. The handler checks the <code>Origin</code> header and
              refuses unknown browser origins with a 403. Desktop clients and
              CLIs, which send no <code>Origin</code>, work normally. Trusted web
              apps go into <code>allowedOrigins</code>.
            </li>
            <li>
              <strong>The schema is enforced, not just advertised.</strong>{" "}
              Arguments are checked against your <code>inputSchema</code> before
              your handler runs.
            </li>
            <li>
              <strong>The boring bits are on too:</strong> body size limits,
              prototype-pollution-safe parsing, and internal errors redacted in
              production, so a failing tool does not leak your database error to
              the model (and from there, to whoever is chatting with it).
            </li>
          </ul>

          <p>
            Here is what the boot guard says when you forget auth. I wrote it to
            be the kind of error message I wish I got at 2 AM:
          </p>

          <CodeBlock code={BOOT_GUARD} language="text" />

          <p>And here is the schema check doing its job:</p>

          <CodeBlock code={SCHEMA_ERROR} />

          <p>
            The enforcement covers the security-relevant subset of JSON Schema:
            types, <code>required</code>, <code>additionalProperties</code>,
            enums and <code>const</code>, and length, range and item-count
            bounds, including nested objects and arrays. Anything you express
            only with <code>pattern</code>, <code>format</code>,{" "}
            <code>$ref</code> or <code>anyOf</code> still needs a check in the
            handler. (<code>pattern</code> is skipped on purpose, so your regex
            can never become a ReDoS target for attacker-controlled input.) The{" "}
            <Link href={"/docs/mcp#input-schema-enforcement" as Route}>
              docs list exactly what is covered
            </Link>
            , because &quot;we validate your input&quot; with a hidden asterisk is
            how people get hurt.
          </p>

          <h2>Tools that should ask a human first</h2>

          <p>
            Some tools should not run just because a model felt confident.
            Deploying, refunding, deleting. The current spec lets a tool pause and
            ask the user a question through the client, then continue when the
            answer comes back. DaloyJS supports it, and the interesting part is
            the <code>requestState</code> the tool hands out while it waits:
          </p>

          <CodeBlock code={ASK_FIRST} />

          <p>
            That state travels through the client and comes back on the retry, so
            by the time you read it, anyone could have edited it. An unsigned
            blob there is a request-forgery primitive with a nice JSON shape. Sign
            it, bind it to the user and the thing being changed, and reject it
            when it does not verify. The{" "}
            <Link href={"/docs/mcp#multi-round-trip-requests" as Route}>
              full example
            </Link>{" "}
            shows the verify side too.
          </p>

          <h2>What stays out of core</h2>

          <p>
            No stdio transport, no OAuth authorization-server metadata, no
            subscription stream, and none of the features the spec deprecated in <code>2026-07-28</code> (Roots,
            Sampling, Logging, the old HTTP+SSE transport). New servers should not
            adopt them, so DaloyJS does not reimplement them just to have a longer
            feature list. If you need auth for remote clients, put your identity
            provider in front and verify its tokens in middleware, the same way
            you would for any API. The{" "}
            <Link href={"/docs/mcp#what-stays-out-of-core" as Route}>
              docs explain each one
            </Link>
            .
          </p>

          <h2>MCP or A2A?</h2>

          <p>
            Same rule as last time: pick by who is calling. If an AI assistant
            needs to use your API as a set of tools, that is MCP, and this post.
            If another company&apos;s agent needs to hand your service a whole job
            and get a result back, that is{" "}
            <Link href={"/docs/a2a" as Route}>A2A</Link>. One DaloyJS app can do
            both, next to its normal REST API, with the same auth and validation
            for all three.
          </p>

          <h2>A small confession</h2>

          <p>
            The docs MCP server on this very website, the one at{" "}
            <code>/mcp</code> that lets your assistant search these docs, does
            not run on DaloyJS. It runs on Vercel&apos;s <code>mcp-handler</code>.
            The shoemaker&apos;s children, shoes, you know how it goes. I am not
            going to pretend otherwise in a post about honest defaults. Moving it
            over is overdue.
          </p>

          <h2>Try it</h2>

          <p>
            MCP support has been in <code>@daloyjs/core</code> since 1.0.0, so
            there is nothing extra to install. Start with the{" "}
            <Link href={"/docs/mcp" as Route}>MCP server docs</Link>, run through
            the{" "}
            <Link href={"/docs/mcp#security-checklist" as Route}>
              security checklist
            </Link>{" "}
            before you ship, and read{" "}
            <Link href={"/docs/security/boot-guards" as Route}>boot guards</Link>{" "}
            if you want to know what else refuses to run in production. Give the
            model a token. It is very polite, and it should still authenticate.
          </p>

          <div className="not-prose mt-10 rounded-2xl border bg-muted/35 p-5">
            <p className="text-sm leading-7 text-muted-foreground">
              <span className="font-semibold text-foreground">
                About the author:
              </span>{" "}
              {POST.authorBio}
            </p>
          </div>
        </div>
      </article>
    </main>
  );
}
