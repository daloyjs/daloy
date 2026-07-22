import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloyjs-2027-vibe-coding-apocalypse-express-alternative",
  title:
    "DaloyJS in 2027: The TypeScript REST API Framework Built for the Vibe-Coding Apocalypse and Alternative to Express?",
  description:
    "Vibe-coded apps are getting breached because nobody reads the code anymore. Here is the blunt case for DaloyJS, a secure-by-default, runtime-agnostic TypeScript REST framework, why it is the Express alternative I now reach for, and the migration guide that actually gets you there.",
  date: "2026-06-22",
  readingTime: "17 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
  authorBio:
    "Filipino developer in Norway, about ten years of shipping backends, and still convinced that the most dangerous line of code is the one nobody read before deploying it.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "DaloyJS 2027",
    "vibe coding security",
    "Express alternative",
    "TypeScript REST API framework",
    "secure by default framework",
    "migrate from Express",
    "runtime agnostic framework",
    "zero runtime dependencies",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HELLO_WORLD = `import { z } from "zod";
import {
  App,
  NotFoundError,
  secureHeaders,
  rateLimit,
  requestId,
} from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App({ bodyLimitBytes: 1024 * 1024, requestTimeoutMs: 5_000 });

// First-party security middleware. In other frameworks this is three plugins,
// three READMEs, and one Stack Overflow tab you never close.
app.use(requestId());
app.use(secureHeaders());
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.route({
  method: "GET",
  path: "/books/:id",
  operationId: "getBookById",
  tags: ["Books"],
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Found",
      body: z.object({ id: z.string(), title: z.string() }),
    },
    404: { description: "Not found" },
  },
  handler: async ({ params }) => ({
    status: 200,
    body: { id: params.id, title: \`Book \${params.id}\` },
  }),
});

serve(app, { port: 3000 });`;

const REFUSE_BOOT = `// This throws at construction. Your CI catches it. Not your incident channel.
const app = new App({
  cors: { origin: "*", credentials: true },
});`;

const FETCH_GUARD = `import { fetchGuard } from "@daloyjs/core";

const safeFetch = fetchGuard();

app.route({
  method: "POST",
  path: "/import",
  operationId: "import",
  request: { json: z.object({ url: z.url() }) },
  responses: { 200: { description: "ok" } },
  handler: async ({ request }) => {
    const { url } = await request.json();
    const upstream = await safeFetch(url); // refuses 169.254.169.254
    return { status: 200 as const, body: await upstream.text() };
  },
});`;

const JWT_JWK = `import { jwk } from "@daloyjs/core/jwk";
import { requireScopes, every } from "@daloyjs/core";

// Verify tokens against your identity provider's JWKS.
const auth = jwk({
  jwksUri: "https://your-tenant.auth-provider.com/.well-known/jwks.json",
  issuer: "https://your-tenant.auth-provider.com/",
  audience: "https://api.yourapp.com",
});

app.route({
  method: "DELETE",
  path: "/projects/:id",
  operationId: "deleteProject",
  auth: { scheme: "bearer" },
  // Compose multiple guards with every(...): both must pass.
  // (An array here would silently apply NO hooks; the framework refuses it.)
  hooks: every(auth, requireScopes(["projects:write"])),
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Deleted" },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
  handler: async ({ params }) => {
    // ... by the time you are here, the token is verified and scoped
    return { status: 204 as const };
  },
});`;

const TYPED_CLIENT = `import { createClient } from "@daloyjs/core/client";

const client = createClient(app, { baseUrl: "http://localhost:3000" });

const r = await client.getBookById({ params: { id: "1" } });
//    ^? { status: 200; body: { id: string; title: string } } | { status: 404; ... }`;

const DOCS_ONE_LINER = `const app = new App({
  openapi: { info: { title: "My API", version: "1.0.0" } },
  docs: true, // mounts GET /docs (Scalar), GET /openapi.json, GET /openapi.yaml
});`;

const FULLER_ROUTE = `import { z } from "zod";
import { App, NotFoundError, bearerAuth, secureHeaders, requestId } from "@daloyjs/core";

const BookSchema = z.object({ id: z.string(), title: z.string() });

const app = new App({ docs: true, bodyLimitBytes: 64 * 1024 })
  .use(requestId())
  .use(secureHeaders())
  .route({
    method: "POST",
    path: "/books",
    operationId: "createBook",
    tags: ["Books"],
    auth: { scheme: "bearer" },
    hooks: bearerAuth({ validate: (t) => t === process.env.API_TOKEN }),
    request: { body: BookSchema },
    responses: {
      201: { description: "Created", body: BookSchema },
      401: { description: "Unauthorized" },
      422: { description: "Validation error" },
    },
    handler: async ({ body }) => {
      // body is already validated and typed as { id: string; title: string }.
      return { status: 201 as const, body };
    },
  });`;

const HARDENED_NPMRC = `ignore-scripts=true
minimum-release-age=1440
strict-peer-dependencies=true
prefer-frozen-lockfile=true
verify-store-integrity=true
provenance=true`;

const DEFENSE = `import { waf } from "@daloyjs/core/waf";
import { autoBan } from "@daloyjs/core/auto-ban";

app.use(waf({ mode: "block", blockThreshold: 5 }));
app.use(autoBan({ trustProxyHeaders: false, banMs: 60_000 }));`;

const RUNTIMES = `import { serve } from "@daloyjs/core/node";        // Node: Railway, Render, Fly, Heroku
import { serve } from "@daloyjs/core/bun";          // Bun
import { serve } from "@daloyjs/core/deno";         // Deno
import { toFetchHandler } from "@daloyjs/core/cloudflare"; // Cloudflare Workers
import { toFetchHandler } from "@daloyjs/core/vercel";     // Vercel Node / Edge
import { toLambdaHandler } from "@daloyjs/core/lambda";    // AWS Lambda`;

const MENTAL_MODEL = `EXPRESS                              DALOYJS
-------                              -------
app.get(path, (req,res,next) => {    app.route({
  // read from req                     method, path, operationId,
  // mutate res                        request:  { params, query, body },  // schemas
  // res.send() / res.json()           responses:{ 200: { body }, 404: {...} },
  // or next(err)                      handler: async (ctx) => {
})                                       // ctx.params/query/body validated + typed
                                         return { status: 200, body };   // you RETURN
                                       },
                                     })

middleware chain (req,res,next)       hooks (onRequest, preBody, beforeHandle,
                                       afterHandle, onError, onSend, onResponse)
express.Router() mini-app             app.group(prefix, opts, fn) / plugins
error mw (err,req,res,next)           throw new NotFoundError(...) + onError hook
app.listen(3000)                      serve(app, { port: 3000 })  // from an adapter`;

const EXPRESS_ROUTE = `// Express
app.use(express.json()); // required, or req.body is undefined

app.post("/books", requireToken, (req, res) => {
  const { id, title } = req.body;
  if (!id || !title) return res.status(400).json({ error: "id and title required" });
  const book = { id, title };
  books.set(id, book);
  res.status(201).json(book);
});

// and somewhere, the one error middleware you must not forget
app.use((err, req, res, next) => {
  res.status(500).json({ error: "internal" });
});`;

const DALOY_ROUTE = `// DaloyJS
import { z } from "zod";
import { App, bearerAuth, NotFoundError } from "@daloyjs/core";

const Book = z.object({ id: z.string(), title: z.string().min(1) });

app.route({
  method: "POST",
  path: "/books",
  operationId: "createBook",
  auth: { scheme: "bearer" },
  hooks: bearerAuth({ validate: (t) => t === process.env.API_TOKEN }),
  request: { body: Book }, // validation replaces the manual if-check
  responses: {
    201: { description: "Created", body: Book },
    401: { description: "Unauthorized" },
    422: { description: "Validation error" }, // returned for you on bad input
  },
  handler: async ({ body }) => {
    books.set(body.id, body);
    return { status: 201, body };
  },
});`;

const SCAFFOLD = `pnpm create daloy@latest my-api

# add GitHub Actions, CODEOWNERS, Dependabot, and a SECURITY.md for a company repo
pnpm create daloy@latest my-api --with-ci --code-owner @acme/security`;

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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/blog" className="underline-offset-4 hover:underline">
              ← Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Security</Badge>
            <Badge variant="outline">Vibe coding</Badge>
            <Badge variant="outline">Express alternative</Badge>
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
            I have been writing backends for about ten years now. I started in
            Manila, I now live in Norway, and somewhere along that journey I
            learned a hard truth: most production incidents are not caused by
            clever attackers. They are caused by us shipping code that we never
            really read. In 2027 that problem has a name, and the name is vibe
            coding.
          </p>
          <p>
            Let me explain what I mean, because &quot;vibe coding&quot; gets
            thrown around as a joke and it is not a joke anymore.
          </p>

          <h2>The state of the world in 2027</h2>
          <p>
            Most backend code today is written by an AI. I am not being
            dramatic. Non-developers describe an app in plain English, the model
            produces something that runs, and it gets deployed within the hour.
            Engineers are doing the same thing, just with more confidence and
            slightly better commit messages. We let agents install dependencies,
            run the tests, and open the pull request. The code works on the
            happy path, the demo looks great, everyone claps.
          </p>
          <p>
            Then it goes to production with no body limits, input validation
            that is &quot;optional&quot; because it slowed down the demo, an
            admin route that somebody forgot to unmount, and an outbound{" "}
            <code>fetch</code> that will cheerfully call{" "}
            <code>http://169.254.169.254/latest/meta-data/</code> if you ask it
            nicely. The app is one crafted request away from leaking its own
            cloud credentials, and nobody on the team can tell you that, because
            nobody on the team wrote that line.
          </p>
          <p>
            The model did exactly what the prompt asked: &quot;make it
            work.&quot; The prompt omitted the security requirements, and there
            is a famous line from the Supabase and Aikido write-up on
            secure-by-default development that I keep pinned to my monitor:{" "}
            <em>
              &quot;If you tell an AI to make something work, it might remove
              the very security checks that protect you.&quot;
            </em>{" "}
            That is the whole problem in one sentence. The model optimizes for
            the request, and &quot;make it work&quot; almost never includes
            &quot;and also do not let strangers read my database.&quot;
          </p>
          <p>
            On top of that, the dependency tree itself became the attack
            surface. In the last couple of years we have watched
            self-replicating npm worms, malicious <code>postinstall</code>{" "}
            scripts, CI cache poisoning, and a newer favorite called
            slopsquatting, where an attacker pre-registers a package name that
            an AI assistant is statistically likely to hallucinate. Your agent
            confidently runs <code>pnpm add @types/fastify-helmet</code>
            {", "}the package exists because somebody was waiting for exactly
            that hallucination, and now you have a wallet drainer in your
            lockfile. Fun.
          </p>
          <p>
            So that is the environment. Fast code, written by machines, deployed
            by people who trust the machine, on top of a registry that has
            become a minefield. This is the world DaloyJS was built for. Not the
            world of five years ago. This one.
          </p>

          <h2>What DaloyJS actually is</h2>
          <p>
            DaloyJS (<code>@daloyjs/core</code>) is a runtime-portable,
            contract-first TypeScript web framework. That is a mouthful, so here
            is the plain version. You define a route once. That single
            definition is the source of truth for validation, your TypeScript
            types, your OpenAPI 3.1 document, your typed client, and your
            contract tests. No decorators, no separate schema files that drift
            out of sync, no &quot;the docs say one thing and the code does
            another&quot; energy.
          </p>
          <p>
            And it runs the same code on Node, Bun, Deno, Cloudflare Workers,
            Vercel (Node and Edge), Fastly Compute, and AWS Lambda. The core
            only ever sees a web-standard <code>Request</code> and returns a{" "}
            <code>Response</code>
            {". "}The runtime-specific stuff lives in thin adapters at the edge.
          </p>
          <p>
            But the part I actually care about, the part that made me stop using
            other frameworks for new projects, is the design stance. DaloyJS
            attacks the vibe-coding problem from two directions at the same
            time.
          </p>
          <ol>
            <li>
              A secure-by-default runtime. The dangerous things are off until
              you turn them on. The safe things are on until you turn them off.
              The framework will literally refuse to boot on certain unsafe
              configurations.
            </li>
            <li>
              A hardened supply chain. Zero runtime dependencies, npm
              provenance, SBOMs, and a pnpm posture that assumes the registry is
              hostile, because it is.
            </li>
          </ol>
          <p>
            The trick, and the reason I am writing a whole blog post about it
            instead of one tweet, is that none of this costs you developer
            experience. The secure path is also the path of least resistance.
            You do not earn security by suffering. You get it by default and
            then you have to go out of your way to remove it. That is the
            inversion that matters.
          </p>
          <p>
            Let me show you, because I trust code more than I trust adjectives.
          </p>

          <h2>Hello world, and notice what you did not have to do</h2>
          <CodeBlock language="ts" code={HELLO_WORLD} />
          <p>
            That is a complete API. Here is what you got for free without typing
            a single extra line: a hard body-size cap so a 4GB upload cannot eat
            your memory, a request timeout so a slow-loris client cannot hold
            your handlers hostage, a JSON parser that strips{" "}
            <code>__proto__</code> and <code>constructor</code> so prototype
            pollution does not happen, a router that rejects <code>..</code>{" "}
            path segments before it walks anything, header sanitizers that
            reject CRLF and NUL so nobody can smuggle a response split through
            your logs, and RFC 9457 problem+json errors that redact their{" "}
            <code>detail</code> field in production so your 500 does not hand a
            stranger a stack trace.
          </p>
          <p>
            The validator is Zod 4 here, but DaloyJS speaks Standard Schema, so
            Valibot, ArkType, and TypeBox all work too. No lock-in. If your team
            already has opinions about schema libraries, bring them.
          </p>
          <p>
            Now compare that to a typical vibe-coded Express app. The model
            gives you <code>{`app.get('/books/:id', ...)`}</code>
            {", "}it works, it ships. There is no body limit. There is no
            timeout. The JSON parser will happily accept{" "}
            <code>{`{"__proto__": {"isAdmin": true}}`}</code>
            {". "}The error handler prints the stack trace because that was
            helpful during development and nobody removed it. None of that is
            malicious. It is just absence. DaloyJS is built on the idea that
            absence is the bug.
          </p>

          <h2>The framework that refuses to start</h2>
          <p>
            This is my favorite feature and it sounds aggressive when you first
            hear it. DaloyJS will refuse to boot if you configure it in a way
            that is known to be dangerous. It does not warn. It does not log
            politely and continue. It throws and your process does not come up.
          </p>
          <p>Things that will stop your app from starting:</p>
          <ul>
            <li>
              <code>{`cors({ origin: "*" })`}</code> with{" "}
              <code>credentials: true</code>
              {". "}This is the classic &quot;I just wanted the CORS error to go
              away&quot; move, and it is also how you let any website on the
              internet make authenticated requests as your logged-in user.
              DaloyJS throws at construction.
            </li>
            <li>
              A weak session secret. If your secret is shorter than 32 bytes or
              is one of the known weak strings (think <code>{`"secret"`}</code>
              {", "}
              <code>{`"changeme"`}</code>), it will not boot.
            </li>
            <li>
              A <code>session()</code> plus a state-changing route with no{" "}
              <code>csrf()</code> protection. The framework notices you have
              cookies and a POST route and no CSRF, and it stops you.
            </li>
            <li>
              Unconfigured <code>X-Forwarded-*</code> handling in production. If
              you are behind a proxy and you have not told the framework whom to
              trust, it will not silently believe spoofed client IPs.
            </li>
          </ul>
          <CodeBlock language="ts" code={REFUSE_BOOT} />
          <p>
            I know some of you just twitched. &quot;What if I have a legitimate
            reason?&quot; Then you fix the default for everyone with a scoped
            knob, you do not strip the guardrail inline. The framework&apos;s
            philosophy, which is written into its contributor rules in capital
            letters, is that bad defaults are bugs. If a guard genuinely blocks
            a real use case, the answer is a narrower override, not a deleted
            check. For service-to-service deployments behind a mesh there is
            even a <code>{`preset: "internal-service"`}</code> that turns off
            the browser-only guards (the CORS guard, the CSRF boot guard, auto
            secure headers) while keeping every input, parser, credential, and
            SSRF guard on. The choice gets logged at boot, and you can audit the
            live posture with <code>app.getSecurityPosture()</code>
            {". "}Opt-in, visible, reversible. That is the pattern.
          </p>
          <p>
            This matters specifically for vibe coding because the failure mode
            of an AI is not malice, it is plausibility. The model writes config
            that looks correct. A refuse-to-boot guard converts &quot;looks
            correct&quot; into &quot;actually correct or the process dies,&quot;
            and a dead process in CI is a million times cheaper than a live
            process in production.
          </p>

          <h2>SSRF, or the call your handler should never make</h2>
          <p>
            Here is the one that keeps cloud engineers up at night. Your app
            takes a URL from a user, maybe for a webhook, an image import, a
            link preview. The handler does <code>await fetch(url)</code>
            {". "}An attacker passes{" "}
            <code>
              http://169.254.169.254/latest/meta-data/iam/security-credentials/
            </code>
            {", "}your server fetches it, and now the response body contains
            your instance&apos;s IAM credentials. This is Server-Side Request
            Forgery and it is responsible for some of the biggest cloud breaches
            we have on record.
          </p>
          <p>
            DaloyJS ships <code>fetchGuard()</code>
            {", "}which is a drop-in replacement for <code>fetch</code> with a
            hard-deny floor.
          </p>
          <CodeBlock language="ts" code={FETCH_GUARD} />
          <p>
            The deny list is not advisory. It covers every documented cloud
            metadata IP: the AWS, Azure, DigitalOcean, and GCP IMDS address{" "}
            <code>169.254.169.254</code>
            {", "}the AWS ECS task metadata and EKS Pod Identity ranges, the
            Oracle <code>192.0.0.192</code>
            {", "}the Alibaba <code>100.100.100.200</code>
            {", "}link-local, loopback, and private ranges. And here is the
            detail I really like: it re-resolves on redirects, so an attacker
            cannot hand you a friendly <code>https://example.com</code> that
            then <code>302</code>s to <code>http://169.254.169.254</code>
            {". "}The hard-deny floor cannot be lifted by any allow flag. Even
            if you misconfigure your allow list, you cannot accidentally
            re-expose the metadata endpoint. That is what &quot;secure by
            default&quot; means in practice: the safe thing is not something you
            remembered to do, it is something you would have to fight the
            framework to undo.
          </p>

          <h2>Tokens, because everybody gets JWT wrong</h2>
          <p>
            JWT is a minefield and most tutorials walk you straight into it. The{" "}
            <code>{`alg: "none"`}</code> attack, algorithm confusion where an
            attacker swaps RS256 for HS256 and signs with your public key,
            tokens with no expiry that live forever. DaloyJS bakes the lessons
            in.
          </p>
          <CodeBlock language="ts" code={JWT_JWK} />
          <p>
            The signer and verifier refuse <code>{`alg: "none"`}</code>
            {". "}They accept only an explicit algorithm allowlist, never
            &quot;whatever the token claims.&quot; They refuse to mix HS secrets
            with JWK key material, which is the algorithm-confusion defense.
            They refuse to sign a token without an <code>exp</code>
            {". "}And they refuse HS-shaped secrets under 32 bytes per RFC 7518.
            The <code>jwk()</code> middleware is asymmetric-only on purpose,
            requires <code>https://</code> JWKS URLs, caches them with in-flight
            promise dedup, and cross-checks the <code>kid</code> and the
            JWT-versus-JWK algorithm. You do not have to know any of this to be
            protected by it, which is the point. The default is the secure one.
          </p>
          <p>
            DaloyJS is a resource server, by the way, not an identity provider.
            It verifies and enforces tokens. It does not run a login page. Bring
            Keycloak, Zitadel, Auth0, Entra ID, Cognito, whatever you like. Do
            not build your own authorization server. I have seen people try. It
            does not end well.
          </p>

          <h2>
            Now the developer experience, which is why you will actually use it
          </h2>
          <p>
            I have made the security pitch. But here is the thing about security
            tools: if they are miserable to use, people route around them, and a
            guardrail you disabled is worse than no guardrail because it gives
            you false confidence. So the DX has to be genuinely good, not
            &quot;good for a security framework.&quot; Let me show you the part
            that made me a believer.
          </p>
          <p>
            One route definition gives you a typed client with zero codegen.
            Look:
          </p>
          <CodeBlock language="ts" code={TYPED_CLIENT} />
          <p>
            That <code>getBookById</code> method, its input shape, and its
            per-status response union are all inferred from the route
            definition. If you change the route, the client type changes, and
            your consuming code stops compiling until you fix it. No generation
            step, no stale client, no &quot;the mobile team is still on the old
            contract&quot; meeting. For consumers that cannot import your
            TypeScript (a different repo, a different language), one{" "}
            <code>pnpm gen</code> command runs your live OpenAPI spec through
            Hey API and emits a fully typed fetch SDK.
          </p>
          <p>
            And the docs. This is the FastAPI feature everyone wishes Node had,
            and it is one line:
          </p>
          <CodeBlock language="ts" code={DOCS_ONE_LINER} />
          <p>
            That mounts an interactive Scalar UI at <code>/docs</code>
            {", "}plus the JSON and YAML specs, with a strict CSP. Switch to
            Swagger UI or Redoc with one word (<code>{`ui: "swagger"`}</code>).
            The docs are always contract-accurate because they are generated
            from the same route definitions that run your server. They cannot go
            stale. If you omit the <code>info</code> block, DaloyJS reads your{" "}
            <code>package.json</code> for the title and version. Less
            boilerplate, fewer things to forget.
          </p>
          <p>
            Here is a fuller route, the kind I actually write, with auth,
            validation, and typed error responses:
          </p>
          <CodeBlock language="ts" code={FULLER_ROUTE} />
          <p>
            The <code>bearerAuth</code> comparison uses a timing-safe equal
            under the hood, so you do not leak token bytes through response
            timing. The body is validated against the schema before your handler
            runs, and if it fails, the client gets a clean 422 problem+json, not
            a 500 with a stack trace. You declared <code>422</code> in the
            contract, so it is in your OpenAPI doc and your typed client too.
            One source of truth, the whole way down.
          </p>

          <h2>
            The supply chain, because your dependencies are also your attack
            surface
          </h2>
          <p>
            You can write the most careful handler in the world and still get
            owned through a <code>postinstall</code> script in a transitive
            dependency you never chose. So the second front matters as much as
            the first.
          </p>
          <p>
            <code>@daloyjs/core</code> has zero runtime dependencies. Not
            &quot;few.&quot; Zero. That is enforced in CI by a gate called{" "}
            <code>verify:no-runtime-deps</code>
            {", "}and it is treated as a floor, not a goal. A hallucinated
            dependency literally cannot transitively land in the published
            tarball, because there is no dependency tree to hide in. Every
            feature I described in this article, the JWT verifier, the SSRF
            guard, the WAF, the rate limiter, the WebSocket layer, is built on
            web-standard APIs and Node built-ins. No <code>node_modules</code>{" "}
            surprise party.
          </p>
          <p>
            The scaffolder ships a hardened <code>.npmrc</code>
            {": "}
          </p>
          <CodeBlock language="ini" code={HARDENED_NPMRC} />
          <p>
            <code>ignore-scripts=true</code> kills lifecycle-script payloads,
            which is how most install-time worms detonate.{" "}
            <code>minimum-release-age=1440</code> refuses to install anything
            published in the last 24 hours, which is the typical window in which
            a malicious package gets detected and unpublished. Combined, those
            two defaults blunt slopsquatting hard. The attacker pre-registers
            the name your agent will hallucinate, but your install refuses fresh
            packages and refuses lifecycle scripts, and a workspace gate called{" "}
            <code>verify:known-dep-names</code> refuses any top-level dependency
            name that is not on an explicit allowlist. So{" "}
            <code>pnpm add some-hallucinated-name</code> cannot slip into a{" "}
            <code>package.json</code>
            {". "}It forces a one-line diff that a human has to look at. That
            review checkpoint is the whole defense, and the framework makes it
            unavoidable.
          </p>
          <p>
            On top of that, <code>@daloyjs/core</code> is published with npm
            provenance and ships CycloneDX 1.5 plus SPDX 2.3 SBOMs, regenerated
            and verified on every release. There is a whole pile of CI gates
            with names like <code>verify:no-registry-exfiltration</code>
            {", "}
            <code>verify:no-remote-exec</code>
            {", "}
            <code>verify:no-lifecycle-scripts</code>
            {", "}and <code>verify:no-weak-random</code>
            {", "}and they carry IOC coverage for active campaigns. There are
            even gates that scan AI-agent config files (<code>CLAUDE.md</code>
            {", "}
            <code>.cursorrules</code>
            {", "}
            <code>AGENTS.md</code>) for the prompt-injection persistence trick
            the TrapDoor crypto-stealer used, and gates that refuse editor
            configs that auto-run a command on folder open, which is how the
            Miasma worm detonated. The supply chain is treated as hostile, which
            in 2027 is just accurate.
          </p>

          <h2>
            Defense in depth, when the edge WAF is somebody else&apos;s budget
            line
          </h2>
          <p>
            Not every team has a CDN WAF in front of their app. DaloyJS gives
            you first-party, opt-in layers so the framework itself can do some
            of that work:
          </p>
          <ul>
            <li>
              <code>waf()</code> runs a scored inbound inspection pass for SQLi,
              XSS, NoSQL operator injection, and command injection. It is
              defense in depth, not a ModSecurity replacement, and it has a{" "}
              <code>log</code> mode so you can tune against real traffic before
              you start blocking.
            </li>
            <li>
              <code>autoBan()</code> is fail2ban for your app: repeat offenders
              who keep hitting 401/403/429 get temporarily banned, with
              exponential escalation and decay.
            </li>
            <li>
              <code>botGuard()</code> verifies declared crawlers with
              reverse-DNS plus forward-confirm, so a request claiming to be
              Googlebot has to actually be Googlebot.
            </li>
            <li>
              <code>geoBlock()</code>
              {", "}
              <code>ipReputation()</code>
              {", "}
              <code>concurrencyLimit()</code>
              {", "}and <code>requestDecompression()</code> (a zip-bomb guard
              that aborts during inflation) round it out.
            </li>
          </ul>
          <CodeBlock language="ts" code={DEFENSE} />
          <p>
            And on WebSockets, the framework closes the Cross-Site WebSocket
            Hijacking class of bug by refusing to register a production WS route
            unless you provide an Origin policy or explicitly acknowledge a
            cross-origin upgrade. Cookie auth alone does not stop a malicious
            site from opening an authenticated handshake from your user&apos;s
            browser, which is exactly the Storybook CVE-2026-27148 pattern. The
            Origin check runs before your upgrade hook, on both Node and Bun.
            Again: the safe thing is the default, and you have to go out of your
            way to remove it.
          </p>

          <h2>Same code, every runtime</h2>
          <p>
            Because the core is just <code>Request</code> to{" "}
            <code>Response</code>
            {", "}deployment is a one-line import swap. No rewrite when your
            platform decision changes, and platform decisions always change.
          </p>
          <CodeBlock language="ts" code={RUNTIMES} />
          <p>
            The routing is fast too, if you care about that sort of thing (I
            do). Static routes resolve through a single <code>Map.get</code> at
            roughly 12 million ops per second, dynamic routes walk a trie in
            time proportional to the number of path segments, body parsing is
            lazy and only runs when a route declares a body schema, and there is
            no regex on the hot path. The secure defaults do not cost you
            throughput.
          </p>

          <h2>When DaloyJS is a practical Express alternative</h2>
          <p>
            The title of this post ends with a question mark on purpose.
            &quot;Alternative to Express&quot; is a big claim, and Express is
            not bad software. It powered half the internet for a decade, it is
            in my muscle memory, and I have shipped a lot of money-making code
            on top of it. I am not here to dunk on it. I am here to argue that
            the thing that made Express great in 2015, that it does almost
            nothing and gets out of your way, is exactly the thing that makes it
            dangerous in the vibe-coding era of 2027.
          </p>
          <p>
            Think about what an Express app actually is. In its own
            documentation it is described as &quot;essentially a series of
            middleware function calls.&quot; You wire up{" "}
            <code>(req, res, next)</code> callbacks, you mutate <code>res</code>
            {", "}and you call <code>res.send()</code> to end the cycle. That is
            a beautiful, minimal model. It is also a blank canvas, and a blank
            canvas is the worst possible thing to hand an AI that was told to
            &quot;make it work.&quot; The model will not add <code>helmet</code>
            {". "}It will not add a body limit. It will not add a rate limiter
            or a request timeout. It will not validate <code>req.body</code>
            {", "}which is typed <code>any</code>
            {", "}so TypeScript will not save you either. Every one of those is
            something a human has to remember to bolt on, and the entire premise
            of vibe coding is that nobody is remembering anything.
          </p>
          <p>
            So here is the concrete case for DaloyJS as the Express alternative,
            point by point, and none of these are things I made up for a blog
            post. They are the actual reasons written into our migration guide:
          </p>
          <ul>
            <li>
              OpenAPI and a typed client for free. In Express you bolt on{" "}
              <code>swagger-jsdoc</code>
              {", "}hand-write JSDoc comments above each route, and pray they
              stay in sync with the code. They never do. In DaloyJS the route
              definition <em>is</em> the spec, so it cannot drift, and a typed
              SDK falls out of <code>pnpm gen</code>.
            </li>
            <li>
              Validation the type system actually trusts. Express hands you{" "}
              <code>req.body as any</code> and wishes you luck. DaloyJS
              validates with Standard Schema (Zod, Valibot, ArkType) and infers
              your handler&apos;s <code>params</code>
              {", "}
              <code>query</code>
              {", "}and <code>body</code> types from the same schemas that do
              the runtime checking. One source of truth, no casts.
            </li>
            <li>
              Secure defaults instead of a TODO list. This is the whole thesis
              of the article. Express ships almost nothing on the security
              front. DaloyJS ships body limits, request timeouts, header
              sanitization, prototype-pollution-safe JSON, and one-line{" "}
              <code>secureHeaders()</code> and <code>rateLimit()</code> helpers,
              and it refuses to boot on configurations that are known to be
              unsafe.
            </li>
            <li>
              Run the same app everywhere. Express is welded to Node&apos;s{" "}
              <code>http</code> module. DaloyJS is built on web-standard{" "}
              <code>Request</code> and <code>Response</code>
              {", "}so the same app object runs on Node, Bun, Deno, Workers, and
              Lambda. When your platform decision changes (it will), you swap an
              import, not a framework.
            </li>
            <li>
              Zero runtime dependencies. A fresh Express app pulls in dozens of
              transitive packages, and every one of them is a slopsquatting
              target and a <code>postinstall</code> risk.{" "}
              <code>@daloyjs/core</code> has none. There is no dependency tree
              for a malicious package to hide in.
            </li>
          </ul>
          <p>
            There are also times when you should <em>not</em> do this. If your
            app is mostly server-rendered HTML through a view engine like EJS or
            Pug, DaloyJS is API-first and will fight you. If you depend on one
            weird Express middleware with no equivalent and no appetite to port
            it, check that first. And if the app is in stable maintenance-only
            mode, migration has a cost and you should spend that energy
            somewhere with upside. Greenfield services, anything where you were
            about to add OpenAPI anyway, and apps that keep getting bitten by
            untyped <code>req.body</code> bugs are the sweet spot.
          </p>

          <h2>
            We actually wrote the migration guide, so you do not have to guess
          </h2>
          <p>
            Here is the part I am genuinely proud of. A lot of frameworks tell
            you they are &quot;a great Express alternative&quot; and then leave
            you to figure out the move on your own. We wrote the whole thing
            down. There is a complete, no-prior-knowledge{" "}
            <Link href="/docs/migrating/express">
              Migrate from Express.js to DaloyJS
            </Link>{" "}
            guide in the docs that maps every Express concept you already know
            to its DaloyJS equivalent, with before-and-after code for each one.
          </p>
          <p>
            The core mental shift is one sentence: you stop mutating{" "}
            <code>res</code> and calling <code>next()</code>
            {", "}and you start declaring a contract and returning a value. Here
            is the side-by-side that the guide opens with:
          </p>
          <CodeBlock language="text" code={MENTAL_MODEL} />
          <p>
            The thing I want you to notice is how much code <em>disappears</em>{" "}
            in the translation. Take a typical Express route with manual
            validation and manual error handling:
          </p>
          <CodeBlock language="ts" code={EXPRESS_ROUTE} />
          <p>
            The DaloyJS version of that route deletes the body-parser line, the
            manual <code>if (!id || !title)</code> check, the hand-rolled auth
            status, and the catch-all error middleware, and gives you an OpenAPI
            entry and a typed client in exchange:
          </p>
          <CodeBlock language="ts" code={DALOY_ROUTE} />
          <p>
            You throw a <code>NotFoundError</code> instead of building one by
            hand. You declare the <code>422</code> and DaloyJS returns it for
            you when validation fails, so your handler only ever runs on valid
            input. Your <code>helmet</code> becomes <code>secureHeaders()</code>
            {", "}
            <code>express-rate-limit</code> becomes <code>rateLimit()</code>
            {", "}
            <code>csurf</code> becomes <code>csrf()</code>
            {", "}
            <code>cookie-parser</code> becomes <code>readRequestCookie()</code>{" "}
            / <code>serializeCookie()</code>
            {", "}and <code>express.Router()</code> becomes either{" "}
            <code>app.group()</code> or a proper encapsulated plugin. The
            migration guide has the full mapping table for all of them, so you
            are not guessing which DaloyJS thing replaces which Express package.
          </p>
          <p>
            And you do not have to do it in one heroic weekend. The guide
            documents a strangler-fig approach: stand DaloyJS up next to your
            existing Express app, put a reverse proxy in front, and move one
            resource at a time (<code>/books</code> first, then the next),
            pointing the proxy at the new routes as they land and deleting the
            old ones. Both apps can share the same database, the same session
            store, and the same JWT secrets during the transition, so logins
            keep working no matter which app serves a given request. You lock
            each move with contract tests using the in-process{" "}
            <code>app.request()</code> client (no port, no second terminal), and
            you repeat until Express is empty and you can delete it. That is how
            you migrate a real production app without a scary big-bang cut-over.
          </p>
          <p>
            If you want the persuasion version rather than the how-to version,
            there is also a companion post,{" "}
            <Link href="/blog/best-node-express-alternative-daloyjs">
              Why DaloyJS is the best Node.js Express alternative
            </Link>
            {", "}that makes the case in more detail. The migration guide is the
            better read, because it shows you the actual code instead of just
            telling you it is nicer.
          </p>

          <h2>Starting a project</h2>
          <CodeBlock language="bash" code={SCAFFOLD} />
          <p>
            You get a working project with the secure middleware stack already
            wired, <code>docs: true</code> on, a runtime template of your
            choice, and containers that ship with a non-root user,{" "}
            <code>tini</code> as PID 1, a <code>HEALTHCHECK</code>
            {", "}and <code>STOPSIGNAL SIGTERM</code>
            {". "}The <code>--with-ci</code> bundle even signs your pushed
            images with Sigstore Cosign and attaches an SBOM attestation, so
            your consumers can verify the image instead of trusting the
            registry. You did not have to remember any of that. That is the
            recurring theme, in case I have been too subtle: you did not have to
            remember.
          </p>

          <h2>Why I think this is the right bet for 2027</h2>
          <p>
            DaloyJS is maturing in public, and its API follows SemVer. It cannot
            write your business logic or stop every bug. A determined developer
            can still bypass a framework, and I say that as one who has needed
            saving.
          </p>
          <p>
            But here is the argument. The way we build software changed. The
            volume of code went up, the amount of code any human actually reads
            went down, and the registry turned into a hunting ground. In that
            world, the framework cannot be a neutral tool that does whatever you
            ask. It has to have opinions, it has to default to safe, and it has
            to refuse to do the obviously dangerous thing even when you (or your
            AI) confidently ask for it. The security has to be the thing you
            would have to remove on purpose, not the thing you would have to add
            on purpose. Because the one thing we have learned about vibe-coded
            apps is that nobody adds the boring stuff. They just ship.
          </p>
          <p>
            DaloyJS makes the boring stuff the default and the dangerous stuff
            the exception, and it does that without making you miserable. One
            route definition, full types, live docs, a typed client, a hardened
            runtime, and a supply chain that assumes the worst. If you are
            starting a new TypeScript API in 2027, that is the trade I would
            take every single time.
          </p>
          <p>
            Go read the <Link href="/docs/security">security docs</Link>
            {", "}run <code>pnpm create daloy@latest</code>
            {", "}and try to make it boot with a wildcard-credentials CORS
            config. It will tell you no. That &quot;no&quot; is the whole
            product.
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
