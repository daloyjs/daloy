import { CodeBlock } from "../../../../components/code-block";
import Link from "next/link";
import type { Route } from "next";

import { BranchDiagram, FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Migrate from Express.js",
  description:
    "A complete, no-prior-knowledge guide to migrating an existing Express.js app to DaloyJS: routing, middleware, req/res, errors, routers, static files, sessions, file uploads, and a side-by-side full example, plus an incremental strangler-fig strategy.",
  path: "/docs/migrating/express",
  keywords: [
    "Express to DaloyJS migration",
    "migrate Express.js",
    "Express vs DaloyJS",
    "Express middleware to hooks",
    "req res to context",
    "Express router to groups",
    "TypeScript web framework migration",
    "contract-first migration",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Migrate from Express.js to DaloyJS</h1>
      <p>
        This is the long version. If you have an existing Express app and you
        want to move it to DaloyJS, read this top to bottom once, then keep it
        open as a reference while you work. It assumes you know Express a
        little, and assumes nothing about DaloyJS. Every concept is mapped from
        the Express idea you already have to the DaloyJS equivalent, with
        before/after code for each one.
      </p>

      <h2 id="the-five-w-and-apos-s-and-one-h-up-front">The five W&apos;s (and one H), up front</h2>
      <p>
        Before any code, let&apos;s answer the questions you should be asking.
      </p>

      <h3 id="what-is-this-migration-really">What is this migration, really?</h3>
      <p>
        Express is a <strong>routing + middleware</strong> framework. An Express
        app is, in its own words, &quot;essentially a series of middleware
        function calls.&quot; You wire callbacks of the shape{" "}
        <code>(req, res, next)</code> onto paths, mutate <code>res</code>, and
        eventually call something like <code>res.send()</code> to end the cycle.
      </p>
      <p>
        DaloyJS is a <strong>contract-first</strong> framework. Instead of
        imperatively pushing bytes onto a mutable response, you <em>declare</em>{" "}
        each endpoint: its method, path, the schemas for its inputs (params,
        query, headers, body), and the schemas for each possible response. Your
        handler is a pure-ish async function that <strong>returns</strong> a{" "}
        <code>{`{ status, body }`}</code> object. From that single declaration
        DaloyJS validates requests and responses, generates an OpenAPI document,
        serves interactive docs, and produces a fully typed client SDK, all
        without extra code.
      </p>
      <p>
        So the migration is not a find-and-replace. It is a small shift in
        mental model:{" "}
        <strong>
          from &quot;mutate res and call next&quot; to &quot;declare a contract
          and return a value.&quot;
        </strong>{" "}
        Once that clicks, the rest is mechanical.
      </p>

      <BranchDiagram
        title="What one DaloyJS route declaration buys you"
        source={{
          eyebrow: "declare once",
          label: "app.get(path, { ... }, handler)",
          detail: "path, request, responses, handler",
        }}
        branches={[
          {
            eyebrow: "runtime",
            label: "Validated, typed inputs",
            detail: "no req.body as any",
          },
          {
            eyebrow: "spec",
            label: "OpenAPI document",
            detail: "the spec is the route",
          },
          {
            eyebrow: "humans",
            label: "Interactive docs",
            detail: "GET /docs",
          },
          {
            eyebrow: "consumers",
            label: "Typed client SDK",
            detail: "pnpm gen",
          },
        ]}
        caption="In Express you bolt these on separately (swagger-jsdoc, a validator, a hand-written client) and hope they stay in sync. In DaloyJS they all fall out of the one route declaration."
      />

      <h3 id="why-would-you-migrate-at-all">Why would you migrate at all?</h3>
      <ul>
        <li>
          <strong>You want OpenAPI + typed clients for free.</strong> In Express
          you bolt on <code>swagger-jsdoc</code>, hand-write JSDoc, and hope it
          stays in sync. In DaloyJS the spec <em>is</em> the route, so it never
          drifts, and <Link href="/docs/typed-client">a typed SDK</Link> falls
          out of <code>pnpm gen</code>.
        </li>
        <li>
          <strong>You want validation that the type system trusts.</strong>{" "}
          DaloyJS validates with{" "}
          <Link href="/docs/validation">Standard Schema</Link> (Zod, Valibot,
          ArkType, ...) and <em>infers</em> the handler&apos;s{" "}
          <code>params</code>/<code>query</code>/<code>body</code> types from
          those schemas. No more <code>req.body as any</code>.
        </li>
        <li>
          <strong>You want secure defaults instead of a TODO list.</strong>{" "}
          Express ships almost nothing; you remember to add <code>helmet</code>,
          a rate limiter, a body limit, a request timeout, and you hope nobody
          forgets. DaloyJS ships{" "}
          <Link href="/docs/security/secure-defaults">secure-by-default</Link>{" "}
          body limits, request timeouts, header sanitization, and one-line{" "}
          <code>secureHeaders()</code> / <code>rateLimit()</code> helpers.
        </li>
        <li>
          <strong>You want to run the same app everywhere.</strong> Express is
          tied to Node&apos;s <code>http</code> module. DaloyJS is built on
          web-standard <code>Request</code> / <code>Response</code> and ships{" "}
          <Link href="/docs/adapters">adapters</Link> for Node, Bun, Deno,
          Cloudflare Workers, and more.
        </li>
        <li>
          <strong>You want zero runtime dependencies.</strong> The Express
          dependency tree is dozens of packages. <code>@daloyjs/core</code> has
          no runtime dependencies, which shrinks your supply-chain attack
          surface.
        </li>
      </ul>
      <p>
        If none of those matter to you, that is a legitimate answer too, see the
        next question.
      </p>

      <h3 id="when-should-you-migrate-and-when-should-you-not">When should you migrate (and when should you not)?</h3>
      <p>Good times to migrate:</p>
      <ul>
        <li>
          You are starting a new service or a new API surface (greenfield is the
          easiest case, just start in DaloyJS).
        </li>
        <li>
          You are about to add OpenAPI docs or a client SDK to an Express app
          anyway.
        </li>
        <li>
          You keep getting bitten by untyped <code>req.body</code> / runtime
          validation bugs.
        </li>
        <li>
          You want to deploy to the edge or serverless and Express&apos;s Node
          coupling is in the way.
        </li>
        <li>
          You are doing a security pass and want defaults instead of a
          checklist.
        </li>
      </ul>
      <p>Times to be cautious or stay:</p>
      <ul>
        <li>
          You lean heavily on server-rendered HTML via{" "}
          <strong>view engines</strong> (EJS, Pug, Handlebars). DaloyJS is
          API-first; it can return HTML, but it is not a templating framework.
          See{" "}
          <Link href={"/docs/migrating/express#views" as Route}>
            Views &amp; template engines
          </Link>{" "}
          below.
        </li>
        <li>
          You depend on a niche Express middleware with no equivalent and no
          appetite to port it. Most have equivalents (see the mapping table),
          but check yours first.
        </li>
        <li>
          The app is in maintenance-only mode and stable. Migration has a cost;
          spend it where there is upside.
        </li>
      </ul>
      <p>
        You do <strong>not</strong> have to migrate in one weekend. The{" "}
        <Link href={"/docs/migrating/express#incremental" as Route}>
          incremental strategy
        </Link>{" "}
        below lets the two frameworks run side by side while you move routes
        over one at a time.
      </p>

      <h3 id="where-does-daloyjs-fit">Where does DaloyJS fit?</h3>
      <p>
        DaloyJS targets <strong>JSON/HTTP APIs and services</strong>: REST
        backends, BFFs, internal microservices, webhook receivers, serverless
        functions, edge APIs. If your Express app is mostly{" "}
        <code>res.json(...)</code>, you are squarely in the sweet spot. If it is
        mostly <code>res.render(...)</code>, weigh the{" "}
        <Link href="/docs/where-to-use">where-to-use guide</Link> first.
      </p>

      <h3 id="who-should-do-this">Who should do this?</h3>
      <p>
        Any TypeScript-comfortable developer. You do not need to be a framework
        expert. DaloyJS is TypeScript-first, so the biggest prerequisite is a{" "}
        <code>tsconfig.json</code> and being okay writing types (the framework
        writes most of them for you). If your Express app is plain JavaScript,
        budget a little time to add TypeScript, it pays for itself immediately
        because the contract-first model leans on inference.
      </p>

      <h3 id="how-in-one-sentence">How, in one sentence?</h3>
      <p>
        Stand up an empty DaloyJS app, port your middleware to hooks/plugins,
        rewrite each <code>app.METHOD(path, handler)</code> as an{" "}
        <code>app.method(path, {"{ ... }"}, handler)</code> declaration that
        returns a value instead of mutating <code>res</code>, replace your error middleware with
        thrown <code>HttpError</code> values, and swap <code>app.listen()</code>{" "}
        for a <Link href="/docs/adapters/node">runtime adapter</Link>. The rest
        of this page is that sentence, expanded.
      </p>

      <h2 id="the-mental-model-side-by-side">The mental model, side by side</h2>
      <p>
        Hold these two pictures in your head. Everything else follows from the
        difference.
      </p>
      <CodeBlock
        language="text"
        code={`EXPRESS                              DALOYJS
-------                              -------
app.get(path, (req,res,next) => {    app.route({
  // read from req                     method, path, operationId,
  // mutate res                        request:  { params, query, body },  // schemas
  // res.send() / res.json()           responses:{ 200: { body }, 404: {...} },
  // or next(err)                      handler: async (ctx) => {
})                                       // ctx.params/query/body are validated + typed
                                         return { status: 200, body };       // you RETURN
                                       },
                                     })

middleware chain (req,res,next)       hooks (onRequest, preBody, beforeHandle,
                                       afterHandle, onError, onSend, onResponse)

express.Router() mini-app             app.group(prefix, opts, fn) / plugins

error-handling mw (err,req,res,next)  throw new NotFoundError(...) + onError hook

app.listen(3000)                      serve(app, { port: 3000 })  // from an adapter`}
      />
      <p>Key differences to internalize:</p>
      <ul>
        <li>
          <strong>You return, you don&apos;t mutate.</strong> There is no{" "}
          <code>res</code> to push onto and no <code>next()</code> to forget. A
          handler returns <code>{`{ status, body, headers? }`}</code>, and the
          status code is type-checked against your declared{" "}
          <code>responses</code>.
        </li>
        <li>
          <strong>Inputs are validated before your handler runs.</strong> If the
          body fails its schema, the client gets a{" "}
          <Link href="/docs/errors">problem+json 422</Link> automatically, your
          handler is never called.
        </li>
        <li>
          <strong>Order is structured, not positional.</strong> Express runs
          middleware in the exact order you call <code>app.use</code>. DaloyJS
          runs hooks at named lifecycle points (global, then group, then route),
          which is more predictable and removes a whole class of &quot;why
          didn&apos;t my middleware run&quot; bugs.
        </li>
      </ul>

      <h2 id="before-you-start">Before you start</h2>
      <h3 id="prerequisites">Prerequisites</h3>
      <ul>
        <li>
          Node.js &gt;= 24 (DaloyJS also runs on Bun, Deno, Workers, etc.).
        </li>
        <li>pnpm (recommended), or npm/yarn if you must.</li>
        <li>
          TypeScript. If your app is JS, plan to convert at least the new
          entrypoint.
        </li>
      </ul>

      <h3 id="install">Install</h3>
      <p>
        Either scaffold a fresh project with{" "}
        <Link href="/docs/scaffolder">create-daloy</Link> and copy your logic
        into it, or add DaloyJS alongside Express in your existing repo for an{" "}
        <Link href={"/docs/migrating/express#incremental" as Route}>
          incremental migration
        </Link>
        :
      </p>
      <CodeBlock
        language="bash"
        code={`# fresh project (recommended for a clean cut-over)
pnpm create daloy@latest my-api

# or add to an existing repo (incremental migration)
pnpm add @daloyjs/core zod
pnpm add -D typescript @types/node`}
      />
      <p>
        See <Link href="/docs/installation">Installation</Link> for the full
        setup, including the <code>package.json</code> scripts and{" "}
        <code>tsconfig.json</code> DaloyJS expects.
      </p>

      <h2 id="step-1-bootstrap-the-app">Step 1: Bootstrap the app</h2>
      <p>
        The classic Express hello-world becomes an <code>App</code> instance
        plus a runtime adapter. Notice that DaloyJS asks you to set a body limit
        and request timeout up front, those are secure defaults you would have
        had to remember to add in Express.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("hello world");
});

app.listen(3000, () => console.log("listening on 3000"));`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS
import { z } from "zod";
import { App, requestId, secureHeaders } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({
  bodyLimitBytes: 64 * 1024,   // secure default: cap request bodies
  requestTimeoutMs: 5_000,     // secure default: don't hang forever
})
  // "middleware everywhere" -> hooks registered globally
  .use(requestId())
  .use(secureHeaders())
  .get(
    "/",
    {
      operationId: "root",
      responses: { 200: { description: "Greeting", body: z.string() } },
    },
    async () => ({ status: 200, body: "hello world" }),
  );

const { port } = serve(app, { port: 3000 });
console.log(\`listening on http://localhost:\${port}\`);`}
      />
      <p>
        That is the whole shape of a DaloyJS app. The rest of this guide is just
        filling in routes and hooks. Want the interactive docs UI too? Add{" "}
        <code>docs: true</code> to the <code>App</code> options and you get{" "}
        <code>GET /docs</code>, <code>GET /openapi.json</code>, and{" "}
        <code>GET /openapi.yaml</code> for free, no Express equivalent exists
        without extra packages.
      </p>

      <h2 id="step-2-routing">Step 2: Routing</h2>
      <p>
        Every <code>app.get</code> / <code>app.post</code> / etc. becomes a
        matching <code>app.get(path, contract, handler)</code> /{" "}
        <code>app.post(...)</code> call, the HTTP method is simply the function
        you call. Each route needs a unique <code>operationId</code> (this is
        what names the generated client method and the OpenAPI operation).
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
app.get("/", (req, res) => res.send("GET homepage"));
app.post("/", (req, res) => res.send("Got a POST"));
app.put("/user", (req, res) => res.send("PUT /user"));
app.delete("/user", (req, res) => res.send("DELETE /user"));`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS
app.get(
  "/",
  {
    operationId: "getHome",
    responses: { 200: { description: "ok" } },
  },
  async () => ({ status: 200, body: "GET homepage" }),
);

app.post(
  "/",
  {
    operationId: "postHome",
    responses: { 200: { description: "ok" } },
  },
  async () => ({ status: 200, body: "Got a POST" }),
);

// ...one shorthand call per Express route. PUT/DELETE/PATCH/HEAD too;
// OPTIONS has no shorthand, use app.route({ method: "OPTIONS", ... }).`}
      />
      <p>
        Supported methods include <code>GET</code>, <code>POST</code>,{" "}
        <code>PUT</code>, <code>PATCH</code>, <code>DELETE</code>,{" "}
        <code>HEAD</code>, and <code>OPTIONS</code>. <code>HEAD</code> is
        auto-derived from a matching <code>GET</code> when you don&apos;t
        declare it. See <Link href="/docs/routing">Routing</Link> for the full
        reference.
      </p>

      <h3 id="path-parameters">Path parameters</h3>
      <p>
        Express and DaloyJS use the same <code>:name</code> syntax in the path.
        The difference is where the value shows up: Express puts it on{" "}
        <code>req.params</code> (always <code>string</code>); DaloyJS puts it on{" "}
        <code>ctx.params</code>, and if you attach a schema, it is parsed and
        typed for you.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
app.get("/users/:userId/books/:bookId", (req, res) => {
  res.json(req.params); // { userId: "34", bookId: "8989" } (all strings)
});`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS
import { z } from "zod";

app.get(
  "/users/:userId/books/:bookId",
  {
    operationId: "getUserBook",
    request: {
      params: z.object({ userId: z.string(), bookId: z.string() }),
    },
    responses: { 200: { description: "ok" } },
  },
  // ctx.params is { userId: string; bookId: string } - inferred from the schema
  async ({ params }) => ({ status: 200, body: params }),
);`}
      />
      <p>
        <strong>Route path differences to know:</strong> Express 5 uses
        path-to-regexp v8, which supports named wildcards like{" "}
        <code>/files/*filepath</code> and brace-wrapped optional segments like{" "}
        <code>/:file{"{.:ext}"}</code>. Note that Express 5 no longer supports
        inline regular-expression characters inside path strings (they are
        reserved); you can still pass a JavaScript <code>RegExp</code> object as
        the path. DaloyJS uses a trie/radix router with the conventional{" "}
        <code>:param</code> syntax and does <em>not</em> accept regex paths. If
        you rely on a regex route or a complex wildcard, model it as a single
        param plus validation in the handler, or split it into explicit routes.
        This is intentional: predictable, traversal-safe matching beats
        arbitrary regex on a hot path. Path traversal (<code>..</code>) and
        empty segments are rejected by the router before your handler runs.
      </p>

      <h3 id="query-strings-and-request-bodies">Query strings and request bodies</h3>
      <p>
        In Express you read <code>req.query</code> and <code>req.body</code>{" "}
        (after wiring up <code>express.json()</code>), both untyped, both
        unvalidated. In DaloyJS you declare schemas and the validated, typed
        values arrive on <code>ctx</code>. There is no separate body-parser
        step: JSON bodies are parsed automatically and checked against your{" "}
        <code>request.body</code> schema.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
app.use(express.json()); // required, or req.body is undefined
app.post("/search", (req, res) => {
  const term = req.query.q;        // string | string[] | undefined (untyped)
  const { page } = req.body;       // any
  res.json({ term, page });
});`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS - no body-parser line needed
app.post(
  "/search",
  {
    operationId: "search",
    request: {
      query: z.object({ q: z.string().min(1) }),
      body: z.object({ page: z.number().int().min(1).default(1) }),
    },
    responses: {
      200: { description: "ok", body: z.object({ term: z.string(), page: z.number() }) },
      422: { description: "Validation error" }, // returned automatically on bad input
    },
  },
  async ({ query, body }) => ({
    status: 200,
    body: { term: query.q, page: body.page },
  }),
);`}
      />
      <p>
        If a request fails validation, DaloyJS short-circuits with an{" "}
        <Link href="/docs/errors">RFC 9457 problem+json</Link> 422 response
        before your handler runs, so the body is guaranteed valid inside the
        handler. Full schema reference:{" "}
        <Link href="/docs/validation">Validation</Link>.
      </p>

      <h2 id="step-3-middleware-becomes-hooks">Step 3: Middleware becomes hooks</h2>
      <p>
        This is the biggest conceptual change, so go slow here. An Express
        middleware is a function <code>(req, res, next)</code> that can do work,
        optionally mutate <code>req</code>/<code>res</code>, and then either end
        the response or call <code>next()</code>. DaloyJS replaces the
        positional chain with named <strong>hooks</strong> that fire at fixed
        lifecycle points:
      </p>

      <FlowDiagram
        title="The hook lifecycle (replaces the middleware chain)"
        steps={[
          {
            label: "onRequest",
            detail: "raw Request, before parsing",
          },
          {
            label: "validation",
            detail: "schemas checked, 422 on failure",
            tone: "muted",
          },
          {
            label: "beforeHandle",
            detail: "guard; return Response to stop",
          },
          {
            label: "handler",
            detail: "returns { status, body }",
            tone: "accent",
          },
          {
            label: "afterHandle",
            detail: "transform the return value",
          },
          {
            label: "onSend",
            detail: "mutate or replace the response",
          },
          {
            label: "onResponse",
            detail: "fire-and-forget observer",
            tone: "success",
          },
        ]}
        caption="Instead of a positional middleware chain you forget to order, hooks fire at named points. Validation runs before your handler, and onError sits on the error path between beforeHandle and the response."
      />

      <table>
        <thead>
          <tr>
            <th>Lifecycle point</th>
            <th>When it runs</th>
            <th>Express analogue</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>onRequest</code>
            </td>
            <td>
              Earliest, raw <code>Request</code>, before any parsing.
            </td>
            <td>
              Early <code>app.use</code> middleware.
            </td>
          </tr>
          <tr>
            <td>
              <code>beforeHandle</code>
            </td>
            <td>
              After validation, before your handler. Return a{" "}
              <code>Response</code> to short-circuit.
            </td>
            <td>
              Auth/guard middleware that may <code>res.status(401).end()</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>afterHandle</code>
            </td>
            <td>Transform the handler&apos;s return value.</td>
            <td>Response-shaping middleware.</td>
          </tr>
          <tr>
            <td>
              <code>onError</code>
            </td>
            <td>
              On the error path, before serialization. Can replace the error
              response.
            </td>
            <td>
              Error-handling middleware <code>(err, req, res, next)</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>onSend</code>
            </td>
            <td>After the response is built; mutate headers or replace it.</td>
            <td>Middleware that rewrites the outgoing response.</td>
          </tr>
          <tr>
            <td>
              <code>onResponse</code>
            </td>
            <td>Final, fire-and-forget observer. Cannot change anything.</td>
            <td>Logging middleware at the end of the chain.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Hooks compose pipeline-style: global hooks (passed to{" "}
        <code>new App({"{ hooks }"})</code> or via <code>app.use</code>) run
        first, then group hooks, then per-route hooks. You attach them globally
        with <code>app.use(...)</code>, to a group with{" "}
        <code>app.group(prefix, {"{ hooks }"}, ...)</code>, or to a single route
        with the route&apos;s <code>hooks</code> field.
      </p>

      <h3 id="a-logging-middleware">A logging middleware</h3>
      <CodeBlock
        language="typescript"
        code={`// Express
app.use((req, res, next) => {
  console.log("Time:", Date.now(), req.method, req.originalUrl);
  next();
});`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS - same idea as an onRequest/onResponse hook
app.use({
  onRequest(req) {
    console.log("Time:", Date.now(), req.method, new URL(req.url).pathname);
  },
});`}
      />

      <h3 id="an-auth-guard-middleware">An auth guard middleware</h3>
      <p>
        In Express a guard either calls <code>next()</code> or ends the response
        early. In DaloyJS, <code>beforeHandle</code> returns a{" "}
        <code>Response</code> to short-circuit, or returns nothing to continue.
        Even better: throw a typed error and let the framework render it (see
        Step 4).
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
function requireAuth(req, res, next) {
  if (!req.headers["x-auth"]) return res.status(401).send("no auth");
  next();
}
app.get("/admin", requireAuth, (req, res) => res.send("secret"));`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS - per-route hook
import { UnauthorizedError } from "@daloyjs/core";

app.get(
  "/admin",
  {
    operationId: "admin",
    hooks: {
      beforeHandle(ctx) {
        if (!ctx.request.headers.get("x-auth")) {
          throw new UnauthorizedError("no auth");
        }
      },
    },
    responses: { 200: { description: "ok" }, 401: { description: "denied" } },
  },
  async () => ({ status: 200, body: "secret" }),
);`}
      />
      <p>
        For real authentication you rarely hand-roll this. DaloyJS ships{" "}
        <code>bearerAuth()</code>, <code>basicAuth()</code>, JWT/JWK verifiers,
        and sessions, see <Link href="/docs/auth">Authentication</Link>. Those
        are drop-in hooks:{" "}
        <code>{`hooks: bearerAuth({ validate: (t) => ... })`}</code>.
      </p>

      <h3 id="the-built-in-and-third-party-middleware-mapping-table">The built-in &amp; third-party middleware mapping table</h3>
      <p>
        Here is the part you actually came for: what to do with each Express
        middleware you are using today.
      </p>
      <table>
        <thead>
          <tr>
            <th>Express middleware</th>
            <th>DaloyJS replacement</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>express.json()</code>
            </td>
            <td>
              Built in. Declare a <code>request.body</code> schema; JSON is
              parsed and validated automatically.
            </td>
          </tr>
          <tr>
            <td>
              <code>express.urlencoded()</code>
            </td>
            <td>
              Built in when the route declares a <code>request.body</code>{" "}
              schema. DaloyJS parses{" "}
              <code>application/x-www-form-urlencoded</code> into an object and
              validates it, with the same body-size and prototype-pollution
              guards as JSON. Multipart forms: see{" "}
              <Link href="/docs/multipart">multipart</Link>.
            </td>
          </tr>
          <tr>
            <td>
              <code>express.static()</code>
            </td>
            <td>
              No built-in static server (API-first). Serve assets from a
              CDN/object store, or front the app with nginx/Caddy. See{" "}
              <Link href={"/docs/migrating/express#static" as Route}>
                Static files
              </Link>
              .
            </td>
          </tr>
          <tr>
            <td>
              <code>cors</code>
            </td>
            <td>
              <code>cors()</code> from <code>@daloyjs/core</code>.{" "}
              <code>{`app.use(cors({ origin: "https://app.example.com", credentials: true }))`}</code>
              .
            </td>
          </tr>
          <tr>
            <td>
              <code>helmet</code>
            </td>
            <td>
              <code>secureHeaders()</code> for production-grade headers (CSP,
              HSTS, frame options, nosniff, ...). See{" "}
              <Link href="/docs/security">Security</Link>.
            </td>
          </tr>
          <tr>
            <td>
              <code>morgan</code> (logging)
            </td>
            <td>
              An <code>onResponse</code> hook, or the built-in{" "}
              <code>timing()</code> hook plus your logger. See{" "}
              <Link href="/docs/tracing">tracing</Link> /{" "}
              <Link href="/docs/metrics">metrics</Link>.
            </td>
          </tr>
          <tr>
            <td>
              <code>express-rate-limit</code>
            </td>
            <td>
              <code>{`rateLimit({ windowMs, max })`}</code>. Redis-backed store
              available, see{" "}
              <Link href="/docs/security/rate-limit-redis">
                Redis rate-limit store
              </Link>
              .
            </td>
          </tr>
          <tr>
            <td>
              <code>cookie-parser</code>
            </td>
            <td>
              <code>readRequestCookie()</code> to read,{" "}
              <code>serializeCookie()</code> to write. See{" "}
              <Link href={"/docs/migrating/express#sessions" as Route}>
                Cookies &amp; sessions
              </Link>
              .
            </td>
          </tr>
          <tr>
            <td>
              <code>express-session</code>
            </td>
            <td>
              DaloyJS <Link href="/docs/security/session">sessions</Link> with
              secure cookie defaults.
            </td>
          </tr>
          <tr>
            <td>
              <code>csurf</code> / CSRF
            </td>
            <td>
              <code>csrf()</code> hook (fetch-metadata or token strategies). See{" "}
              <Link href="/docs/security/csrf">CSRF protection</Link>.
            </td>
          </tr>
          <tr>
            <td>
              <code>compression</code>
            </td>
            <td>
              <code>compression()</code> hook. See{" "}
              <Link href="/docs/security/compression">compression</Link> (note
              the decompression-bomb guardrails).
            </td>
          </tr>
          <tr>
            <td>
              <code>multer</code> (uploads)
            </td>
            <td>
              Built-in <Link href="/docs/multipart">multipart</Link> parsing
              with size/field guards.
            </td>
          </tr>
          <tr>
            <td>
              <code>passport</code> / auth
            </td>
            <td>
              <code>bearerAuth()</code>, <code>basicAuth()</code>, JWT/JWK, or
              an OIDC provider, see{" "}
              <Link href="/docs/auth">Authentication</Link>.
            </td>
          </tr>
          <tr>
            <td>ETag / conditional GET</td>
            <td>
              <code>etag()</code> hook.
            </td>
          </tr>
          <tr>
            <td>
              Custom <code>(req,res,next)</code> middleware
            </td>
            <td>
              Port the logic into the matching hook (<code>onRequest</code>/
              <code>beforeHandle</code>/<code>onSend</code>) and package
              reusable bundles as <Link href="/docs/plugins">plugins</Link>.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        For combining hooks conditionally (the equivalent of mounting a
        middleware on some paths but not others), DaloyJS exports{" "}
        <code>every</code>, <code>some</code>, and <code>except</code> from{" "}
        <code>@daloyjs/core</code>, e.g. apply CSRF everywhere{" "}
        <code>except</code> your webhook routes.
      </p>

      <h2 id="step-4-error-handling">Step 4: Error handling</h2>
      <p>
        Express centralizes errors in a special four-argument middleware{" "}
        <code>(err, req, res, next)</code>, and you signal errors by calling{" "}
        <code>next(err)</code>. DaloyJS replaces both with{" "}
        <strong>thrown typed errors</strong> plus an optional{" "}
        <code>onError</code> hook. Throw one of the built-in{" "}
        <code>HttpError</code> subclasses (or your own subclass) and the
        framework renders a consistent{" "}
        <Link href="/docs/errors">RFC 9457 problem+json</Link> response with the
        right status code, and in production it redacts internal details
        automatically.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
app.get("/users/:id", async (req, res, next) => {
  try {
    const user = await db.find(req.params.id);
    if (!user) {
      const err = new Error("not found");
      err.status = 404;
      return next(err); // hand off to the error middleware
    }
    res.json(user);
  } catch (e) {
    next(e);
  }
});

// the one error middleware, defined last
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
});`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS - just throw; no try/catch boilerplate, no next(err)
import { NotFoundError } from "@daloyjs/core";

app.get(
  "/users/:id",
  {
    operationId: "getUser",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "ok", body: UserSchema },
      404: { description: "Not found" },
    },
  },
  async ({ params }) => {
    const user = await db.find(params.id);
    if (!user) throw new NotFoundError(\`No user \${params.id}\`);
    return { status: 200, body: user };
  },
);`}
      />
      <p>
        Available out of the box: <code>BadRequestError</code> (400),{" "}
        <code>UnauthorizedError</code> (401), <code>ForbiddenError</code> (403),{" "}
        <code>NotFoundError</code> (404), <code>ConflictError</code> (409),{" "}
        <code>PayloadTooLargeError</code> (413),{" "}
        <code>TooManyRequestsError</code> (429), <code>InternalError</code>{" "}
        (500), and more. Need cross-cutting error behavior (custom logging, a
        Sentry hook, a translated message)? Add a global <code>onError</code>{" "}
        hook, that is your &quot;one error middleware,&quot; but it can&apos;t
        be forgotten and it runs at a defined point:
      </p>
      <CodeBlock
        language="typescript"
        code={`const app = new App({
  hooks: {
    onError(err, ctx) {
      // observe / report; return a Response to override the default rendering
      reportToSentry(err, ctx?.state.requestId);
    },
  },
});`}
      />
      <p>
        One more nicety: because validation runs before your handler, the
        &quot;bad input&quot; error path (Express&apos;s most common manual
        <code>if (!valid) return res.status(400)</code>) disappears entirely.
        DaloyJS returns the 422 for you.
      </p>

      <h2 id="step-5-routers-become-groups-and-plugins">Step 5: Routers become groups (and plugins)</h2>
      <p>
        Express <code>express.Router()</code> &quot;mini-apps&quot; mounted with{" "}
        <code>app.use(&quot;/prefix&quot;, router)</code> map to two DaloyJS
        tools:
      </p>
      <ul>
        <li>
          <strong>
            <code>app.group(prefix, opts, fn)</code>
          </strong>{" "}
          for a prefix + shared tags/hooks within the same file.
        </li>
        <li>
          <strong>
            <Link href="/docs/plugins">Plugins</Link>
          </strong>{" "}
          (<code>app.register(plugin, {"{ prefix }"}</code>) for genuinely
          modular, encapsulated units in their own files, the real
          Router-as-module replacement, with Fastify-style encapsulation so a
          plugin can&apos;t leak its middleware into siblings.
        </li>
      </ul>
      <CodeBlock
        language="typescript"
        code={`// Express - birds.js
const express = require("express");
const router = express.Router();
router.use((req, res, next) => { console.log("time", Date.now()); next(); });
router.get("/", (req, res) => res.send("Birds home"));
router.get("/about", (req, res) => res.send("About birds"));
module.exports = router;

// app.js
app.use("/birds", require("./birds")); // -> /birds and /birds/about`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS - option A: a group (same file)
app.group("/birds", { tags: ["Birds"] }, (birds) => {
  birds.use({ onRequest: () => console.log("time", Date.now()) });

  birds.get(
    "/",
    { operationId: "birdsHome", responses: { 200: { description: "ok" } } },
    async () => ({ status: 200, body: "Birds home" }),
  );

  birds.get(
    "/about",
    { operationId: "birdsAbout", responses: { 200: { description: "ok" } } },
    async () => ({ status: 200, body: "About birds" }),
  );
});
// final paths: /birds and /birds/about`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS - option B: a plugin (its own file, encapsulated)
// birds.plugin.ts
import type { App } from "@daloyjs/core";

export const birdsPlugin = {
  name: "birds",
  register(app: App) {
    app.use({ onRequest: () => console.log("time", Date.now()) });
    app.get(
      "/",
      { operationId: "birdsHome", responses: { 200: { description: "ok" } } },
      async () => ({ status: 200, body: "Birds home" }),
    );
  },
};

// index.ts
app.register(birdsPlugin, { prefix: "/birds", tags: ["Birds"] });
await app.ready();`}
      />
      <p>
        Plugins also support <code>app.decorate(&quot;db&quot;, ...)</code> to
        inject shared resources (a database client, a logger) into every
        handler&apos;s <code>ctx.state</code>, the clean replacement for
        Express&apos;s habit of hanging things off <code>app.locals</code> or{" "}
        <code>req</code>. Augment the <code>AppState</code> interface and those
        decorations are fully typed in every handler.
      </p>

      <h2 id="step-6-request-and-response-object-cheat-sheet">Step 6: Request and response object cheat-sheet</h2>
      <p>
        Express gives you fat <code>req</code> and <code>res</code> objects.
        DaloyJS gives you a typed <code>ctx</code> and you return a value. Here
        is the translation for the things you reach for most.
      </p>

      <h3 id="reading-the-request">Reading the request</h3>
      <table>
        <thead>
          <tr>
            <th>Express</th>
            <th>DaloyJS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>req.params.id</code>
            </td>
            <td>
              <code>ctx.params.id</code> (typed if you add a <code>params</code>{" "}
              schema)
            </td>
          </tr>
          <tr>
            <td>
              <code>req.query.q</code>
            </td>
            <td>
              <code>ctx.query.q</code> (typed via a <code>query</code> schema)
            </td>
          </tr>
          <tr>
            <td>
              <code>req.body</code>
            </td>
            <td>
              <code>ctx.body</code> (typed + validated via a <code>body</code>{" "}
              schema)
            </td>
          </tr>
          <tr>
            <td>
              <code>req.get(&quot;x-foo&quot;)</code> /{" "}
              <code>req.headers[&quot;x-foo&quot;]</code>
            </td>
            <td>
              <code>ctx.request.headers.get(&quot;x-foo&quot;)</code> or a{" "}
              <code>headers</code> schema -&gt; <code>ctx.headers</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>req.method</code> / <code>req.path</code>
            </td>
            <td>
              <code>ctx.request.method</code> /{" "}
              <code>new URL(ctx.request.url).pathname</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>req.cookies.sid</code> (cookie-parser)
            </td>
            <td>
              <code>
                readRequestCookie(ctx.request.headers.get(&quot;cookie&quot;),
                &quot;sid&quot;)
              </code>
            </td>
          </tr>
          <tr>
            <td>
              <code>req.ip</code>
            </td>
            <td>
              <code>readRemoteAddress(ctx)</code> (peer address), or{" "}
              <code>resolveClientIp(ctx.request, cfg)</code> for proxy-aware
              resolution
            </td>
          </tr>
        </tbody>
      </table>

      <h3 id="writing-the-response">Writing the response</h3>
      <table>
        <thead>
          <tr>
            <th>Express</th>
            <th>DaloyJS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>res.json(obj)</code>
            </td>
            <td>
              <code>return {"{ status: 200, body: obj }"}</code> (JSON inferred)
            </td>
          </tr>
          <tr>
            <td>
              <code>res.status(201).json(obj)</code>
            </td>
            <td>
              <code>return {"{ status: 201, body: obj }"}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.send(&quot;text&quot;)</code>
            </td>
            <td>
              <code>return {`{ status: 200, body: "text" }`}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.sendStatus(204)</code>
            </td>
            <td>
              <code>return {"{ status: 204, body: undefined }"}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.set(&quot;x-foo&quot;, &quot;bar&quot;)</code>
            </td>
            <td>
              <code>
                return{" "}
                {
                  `{ status: 200, headers: { "x-foo": "bar" }, body }`
                }
              </code>{" "}
              or <code>ctx.set.headers.set(...)</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.redirect(&quot;/login&quot;)</code>
            </td>
            <td>
              <code>
                return{" "}
                {
                  `{ status: 302, headers: { location: "/login" }, body: undefined }`
                }
              </code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.cookie(&quot;sid&quot;, v)</code>
            </td>
            <td>
              <code>
                ctx.set.headers.set(&quot;set-cookie&quot;,
                serializeCookie(&quot;sid&quot;, v, {"{...}"}))
              </code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.clearCookie(&quot;sid&quot;)</code>
            </td>
            <td>
              <code>
                ctx.set.headers.set(&quot;set-cookie&quot;,
                serializeClearCookie(&quot;sid&quot;))
              </code>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.render(&quot;view&quot;, data)</code>
            </td>
            <td>
              Return HTML you built yourself (DaloyJS is API-first), see{" "}
              <Link href={"/docs/migrating/express#views" as Route}>below</Link>
            </td>
          </tr>
          <tr>
            <td>
              <code>res.download(file)</code> / <code>res.sendFile(file)</code>
            </td>
            <td>
              Stream the file as the body with <code>content-disposition</code>,
              see{" "}
              <Link href={"/docs/migrating/express#static" as Route}>
                below
              </Link>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The big win: in Express, <code>res.status(201).json(...)</code> with a
        status you never documented just works (and silently drifts from your
        docs). In DaloyJS, returning <code>status: 201</code> only type-checks
        if <code>201</code> is declared in that route&apos;s{" "}
        <code>responses</code>. The compiler keeps you honest.
      </p>

      <h2 id="sessions">Cookies and sessions</h2>
      <p>
        Express leans on <code>cookie-parser</code> and{" "}
        <code>express-session</code>. DaloyJS gives you primitives plus a
        first-party session plugin.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
app.use(cookieParser());
app.get("/me", (req, res) => {
  const sid = req.cookies.sid;
  res.cookie("seen", "1", { httpOnly: true, secure: true, sameSite: "lax" });
  res.json({ sid });
});`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS
import { readRequestCookie, serializeCookie } from "@daloyjs/core";

app.get(
  "/me",
  {
    operationId: "me",
    responses: { 200: { description: "ok" } },
  },
  async (ctx) => {
    const sid = readRequestCookie(ctx.request.headers.get("cookie"), "sid");
    ctx.set.headers.set(
      "set-cookie",
      serializeCookie("seen", "1", { httpOnly: true, secure: true, sameSite: "lax" }),
    );
    return { status: 200, body: { sid } };
  },
);`}
      />
      <p>
        For full server-side sessions (login state, rotation, secure cookie
        defaults), use the{" "}
        <Link href="/docs/security/session">session plugin</Link> instead of
        hand-rolling it, and read{" "}
        <Link href="/docs/security/csrf">CSRF protection</Link> if you keep
        cookie-based auth.
      </p>

      <h2 id="static">Static files and downloads</h2>
      <p>
        Express bundles <code>express.static()</code> and{" "}
        <code>res.sendFile()</code> / <code>res.download()</code>. DaloyJS is
        deliberately API-first and ships no static file server. Recommended
        approaches, in order:
      </p>
      <ol>
        <li>
          <strong>Serve static assets from a CDN / object store</strong>{" "}
          (S3+CloudFront, R2, etc.). Best for production regardless of
          framework.
        </li>
        <li>
          <strong>Put a reverse proxy in front</strong> (nginx, Caddy, your
          platform&apos;s edge) that serves <code>/static</code> and forwards
          everything else to DaloyJS.
        </li>
        <li>
          <strong>Stream a specific file from a handler</strong> when you need
          app logic (auth-gated downloads, generated files). Read the file and
          return it as the body with the right headers, set{" "}
          <code>content-disposition: attachment; filename=&quot;...&quot;</code>{" "}
          to reproduce <code>res.download()</code>. Always sanitize untrusted
          filenames with <code>sanitizeFilename()</code> /{" "}
          <code>assertSafeRelativePath()</code> from <code>@daloyjs/core</code>{" "}
          to avoid path traversal.
        </li>
      </ol>
      <CodeBlock
        language="typescript"
        code={`// Auth-gated download (replaces res.download)
import { readFile } from "node:fs/promises";
import { assertSafeRelativePath } from "@daloyjs/core";

app.get(
  "/files/:name",
  {
    operationId: "downloadFile",
    request: { params: z.object({ name: z.string() }) },
    responses: { 200: { description: "file" }, 404: { description: "not found" } },
  },
  async ({ params }) => {
    assertSafeRelativePath(params.name); // throws on "../" traversal
    const data = await readFile(\`./uploads/\${params.name}\`);
    return {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": \`attachment; filename="\${params.name}"\`,
      },
      body: data,
    };
  },
);`}
      />

      <h2 id="views">Views and template engines</h2>
      <p>
        If your Express app calls{" "}
        <code>app.set(&quot;view engine&quot;, &quot;ejs&quot;)</code> and{" "}
        <code>res.render(...)</code> a lot, be honest with yourself: DaloyJS is
        not a templating framework, and forcing server-rendered HTML through it
        fights the grain. Two sane paths:
      </p>
      <ul>
        <li>
          <strong>Split the concern.</strong> Keep DaloyJS for the JSON API and
          move the UI to a frontend (Next.js, Astro, plain SPA) that calls your{" "}
          <Link href="/docs/typed-client">typed client</Link>. This is the
          recommended modern architecture and usually where teams want to end up
          anyway.
        </li>
        <li>
          <strong>Render HTML strings yourself</strong> for the occasional page.
          Build the HTML (with any template library you like, or template
          literals) and return it with a <code>content-type: text/html</code>{" "}
          header. Good for emails, a status page, or a handful of marketing
          routes, not for a full server-rendered app.
        </li>
      </ul>

      <h2 id="step-7-start-the-server-and-shut-it-down-cleanly">Step 7: Start the server (and shut it down cleanly)</h2>
      <p>
        <code>app.listen()</code> is replaced by a runtime adapter&apos;s{" "}
        <code>serve()</code>. On Node that is <code>@daloyjs/core/node</code>,
        which also wires up graceful shutdown for you.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express
const server = app.listen(3000, () => console.log("up on 3000"));
process.on("SIGTERM", () => server.close());`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS
import { serve } from "@daloyjs/core/node";

const { port, close } = serve(app, { port: 3000 });
console.log(\`up on \${port}\`);
// graceful shutdown is handled by the adapter; call close() to stop manually`}
      />
      <p>
        Deploying somewhere other than a long-running Node process? Swap the
        import for the matching <Link href="/docs/adapters">adapter</Link> (Bun,
        Deno, Cloudflare Workers, AWS Lambda, ...), the same{" "}
        <code>app</code> object runs on all of them. That portability is
        something Express simply cannot do, because it is bound to Node&apos;s{" "}
        <code>http</code> module.
      </p>

      <h2 id="a-full-before-after-example">A full before/after example</h2>
      <p>
        Here is a small but complete Express API, a tiny book service with
        listing, fetch-by-id, create, auth, and error handling, followed by its
        DaloyJS equivalent. This is the shape most real migrations take.
      </p>
      <CodeBlock
        language="typescript"
        code={`// Express: server.js
const express = require("express");
const app = express();
app.use(express.json());

const books = new Map([["1", { id: "1", title: "Dune" }]]);

function requireToken(req, res, next) {
  if (req.headers.authorization !== "Bearer secret") {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
app.get("/books", (req, res) => {
  res.json([...books.values()]);
});

app.get("/books/:id", (req, res) => {
  const book = books.get(req.params.id);
  if (!book) return res.status(404).json({ error: "not found" });
  res.json(book);
});

app.post("/books", requireToken, (req, res) => {
  const { id, title } = req.body;
  if (!id || !title) return res.status(400).json({ error: "id and title required" });
  const book = { id, title };
  books.set(id, book);
  res.status(201).json(book);
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: "internal" });
});

app.listen(3000, () => console.log("up on 3000"));`}
      />
      <CodeBlock
        language="typescript"
        code={`// DaloyJS: src/index.ts
import { z } from "zod";
import { App, bearerAuth, secureHeaders, requestId, NotFoundError } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const Book = z.object({ id: z.string(), title: z.string().min(1) });
const books = new Map<string, z.infer<typeof Book>>([["1", { id: "1", title: "Dune" }]]);

const app = new App({
  bodyLimitBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
  openapi: {
    info: { title: "Books API", version: "1.0.0" },
    // declare the scheme referenced by the route's auth field below
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  docs: true, // GET /docs + /openapi.json for free
})
  .use(requestId())
  .use(secureHeaders())
  .get(
    "/books",
    {
      operationId: "listBooks",
      tags: ["Books"],
      responses: { 200: { description: "All books", body: z.array(Book) } },
    },
    async () => ({ status: 200, body: [...books.values()] }),
  )
  .get(
    "/books/:id",
    {
      operationId: "getBook",
      tags: ["Books"],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: { description: "Found", body: Book },
        404: { description: "Not found" },
      },
    },
    async ({ params }) => {
      const book = books.get(params.id);
      if (!book) throw new NotFoundError(\`No book \${params.id}\`);
      return { status: 200, body: book };
    },
  )
  .post(
    "/books",
    {
      operationId: "createBook",
      tags: ["Books"],
      auth: { scheme: "bearer" },
      hooks: bearerAuth({ validate: (t) => t === "secret" }),
      request: { body: Book }, // validation replaces the manual if-check
      responses: {
        201: { description: "Created", body: Book },
        401: { description: "Unauthorized" },
        422: { description: "Validation error" },
      },
    },
    async ({ body }) => {
      books.set(body.id, body);
      return { status: 201, body };
    },
  );

const { port } = serve(app, { port: 3000 });
console.log(\`up on \${port}\`);`}
      />
      <p>
        Look at what disappeared: the body-parser line, the manual{" "}
        <code>if (!id || !title)</code> validation, the hand-rolled auth status
        code, and the catch-all error middleware. Look at what appeared for
        free: an OpenAPI spec, a docs UI, response validation, and a path to a
        typed client. That is the trade the migration makes.
      </p>

      <h2 id="incremental">
        Incremental migration (the strangler-fig approach)
      </h2>
      <p>
        You do not have to flip everything at once. The safest way to migrate a
        large Express app is to <strong>strangle</strong> it: stand the two apps
        side by side and move routes across one slice at a time, with a router
        in front deciding who serves what.
      </p>
      <ol>
        <li>
          <strong>Put a reverse proxy in front of both.</strong> nginx, Caddy,
          or your platform&apos;s router sends already-migrated paths (say{" "}
          <code>/v2/*</code>) to the DaloyJS process and everything else to the
          existing Express process. Nothing in either app needs to know about
          the other.
        </li>
        <li>
          <strong>Migrate by bounded slice, not by file.</strong> Move a whole
          resource (all of <code>/books</code>) at once so you don&apos;t split
          a feature across two frameworks. Mirror its routes in DaloyJS, point
          the proxy at the new one, delete the Express version.
        </li>
        <li>
          <strong>Share nothing fragile.</strong> Both apps can talk to the same
          database and the same session store. Keep cookie names, JWT secrets,
          and session formats identical during the transition so a user&apos;s
          login works no matter which app serves the request.
        </li>
        <li>
          <strong>Lock behavior with contract tests.</strong> Before moving a
          route, capture its current responses. After moving, assert DaloyJS
          returns the same thing. The in-process <code>app.request(...)</code>{" "}
          client (no port needed) makes this fast, see{" "}
          <Link href="/docs/testing">Testing</Link>.
        </li>
        <li>
          <strong>Repeat until Express is empty, then delete it.</strong> When
          the last slice is gone, remove the proxy split and the Express
          dependency tree with it.
        </li>
      </ol>
      <p>
        If you prefer a hard cut-over instead (small apps, or a quiet
        maintenance window), scaffold with{" "}
        <Link href="/docs/scaffolder">create-daloy</Link>, port everything using
        this guide, run your test suite against both, and switch DNS/traffic
        once.
      </p>

      <h2 id="testing-your-migration">Testing your migration</h2>
      <p>
        Every <code>App</code> exposes <code>app.request(input, init?)</code>,
        an in-process client that takes a URL or <code>Request</code> and
        returns a <code>Response</code>, no server, no port, no second terminal.
        It is ideal for porting Supertest-style Express tests and for the
        contract tests in the strangler approach above.
      </p>
      <CodeBlock
        language="typescript"
        code={`import assert from "node:assert/strict";
import { test } from "node:test";

test("GET /books/:id returns 404 for unknown id", async () => {
  const res = await app.request("/books/does-not-exist");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.status, 404); // RFC 9457 problem+json
});`}
      />
      <p>
        See <Link href="/docs/testing">Testing &amp; contract tests</Link> for
        the full patterns, including snapshotting the OpenAPI document to catch
        accidental breaking changes during the migration.
      </p>

      <h2 id="gotchas-and-faq">Gotchas and FAQ</h2>
      <dl>
        <dt>
          <strong>
            &quot;Where did <code>next()</code> go?&quot;
          </strong>
        </dt>
        <dd>
          Nowhere, you don&apos;t need it. Continuing the pipeline is the
          default (a hook that returns nothing just falls through). To stop
          early, return a <code>Response</code> from <code>beforeHandle</code>{" "}
          or throw an error. There is no &quot;forgot to call{" "}
          <code>next()</code> and the request hangs&quot; failure mode.
        </dd>
        <dt>
          <strong>
            &quot;Can I just return a string like <code>res.send</code>?&quot;
          </strong>
        </dt>
        <dd>
          Yes: <code>return {'{ status: 200, body: "hi" }'}</code>. Objects are
          serialized as JSON; strings and buffers are sent as-is. The shape is
          always <code>{`{ status, body, headers? }`}</code>.
        </dd>
        <dt>
          <strong>&quot;My Express route used a regex path.&quot;</strong>
        </dt>
        <dd>
          DaloyJS does not accept regex paths by design. Model it as a normal{" "}
          <code>:param</code> route and validate the param&apos;s shape with a
          schema (<code>z.string().regex(...)</code>), or split into explicit
          routes.
        </dd>
        <dt>
          <strong>
            &quot;I relied on middleware order being exactly my{" "}
            <code>app.use</code> order.&quot;
          </strong>
        </dt>
        <dd>
          Hooks run at named lifecycle points (global &rarr; group &rarr;
          route), which is more predictable. Re-express ordering intent as
          &quot;this is an <code>onRequest</code> vs this is an{" "}
          <code>onSend</code>,&quot; rather than &quot;this <code>use</code>{" "}
          comes before that one.&quot;
        </dd>
        <dt>
          <strong>
            &quot;Do I still need <code>express.json()</code>?&quot;
          </strong>
        </dt>
        <dd>
          No. JSON parsing is built in and gated by your body schema and the
          body-size limit.
        </dd>
        <dt>
          <strong>
            &quot;What about <code>app.locals</code> / <code>res.locals</code>
            ?&quot;
          </strong>
        </dt>
        <dd>
          Use <code>app.decorate(...)</code> for app-wide shared resources
          (typed onto <code>ctx.state</code>) and just set values on{" "}
          <code>ctx.state</code> within a request for per-request data.
        </dd>
        <dt>
          <strong>
            &quot;Is there a code-mod to do this automatically?&quot;
          </strong>
        </dt>
        <dd>
          No, and that is on purpose. The translation is mechanical but the{" "}
          <em>contracts</em> (your schemas and documented responses) are the
          valuable part, and only you know them. Writing them is the migration.
        </dd>
      </dl>

      <h2 id="migration-checklist">Migration checklist</h2>
      <ul>
        <li>
          Create the DaloyJS <code>App</code> with a body limit + request
          timeout.
        </li>
        <li>
          Add <code>requestId()</code> + <code>secureHeaders()</code> (replace{" "}
          <code>helmet</code>).
        </li>
        <li>
          Map each global Express middleware to a hook or built-in (use the
          table above).
        </li>
        <li>
          Rewrite each <code>app.METHOD(path, ...)</code> as an{" "}
          <code>app.method(path, {"{...}"}, handler)</code> call with a unique{" "}
          <code>operationId</code>.
        </li>
        <li>
          Add <code>request</code> schemas for params/query/body, delete manual
          validation.
        </li>
        <li>
          Declare every <code>responses</code> status you actually return.
        </li>
        <li>
          Replace <code>next(err)</code> + error middleware with thrown{" "}
          <code>HttpError</code> values and an optional <code>onError</code>{" "}
          hook.
        </li>
        <li>
          Turn routers into <code>app.group(...)</code> or{" "}
          <Link href="/docs/plugins">plugins</Link>.
        </li>
        <li>
          Move static assets to a CDN/proxy; re-implement gated downloads as
          streaming handlers.
        </li>
        <li>
          Replace <code>app.listen()</code> with the right{" "}
          <Link href="/docs/adapters">adapter</Link>&apos;s <code>serve()</code>
          .
        </li>
        <li>
          Port tests to <code>app.request(...)</code>; add OpenAPI snapshot
          tests.
        </li>
        <li>
          Turn on <code>docs: true</code> and enjoy the free spec + client SDK.
        </li>
      </ul>

      <h2 id="where-to-go-next">Where to go next</h2>
      <ul>
        <li>
          <Link href="/docs/getting-started">Getting started</Link>, build a
          fresh DaloyJS app end to end.
        </li>
        <li>
          <Link href="/docs/routing">Routing</Link> and{" "}
          <Link href="/docs/validation">Validation</Link>, the contract-first
          core.
        </li>
        <li>
          <Link href="/docs/plugins">Plugins &amp; encapsulation</Link>, the
          real Router replacement.
        </li>
        <li>
          <Link href="/docs/errors">Errors &amp; problem+json</Link>, the
          error-handling model.
        </li>
        <li>
          <Link href="/docs/security">Security</Link>, what you get for free
          instead of a checklist.
        </li>
        <li>
          <Link href="/docs/typed-client">Typed clients</Link>, the payoff of
          going contract-first.
        </li>
        <li>
          <Link href="/blog/best-node-express-alternative-daloyjs">
            Why DaloyJS is the best Node.js Express alternative
          </Link>
          , the case for switching, if you still need to make it.
        </li>
      </ul>
    </>
  );
}
