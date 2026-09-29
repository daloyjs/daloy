import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "your-api-can-now-be-an-a2a-agent",
  title: "Your API Can Now Be an Agent: A2A in DaloyJS 1.4.0",
  description:
    "MCP lets an AI tool call your API. A2A lets another company's agent hand your service a job. DaloyJS 1.4.0 speaks A2A 1.0 with one onMessage function, and it deliberately does not guess what your agent should do.",
  date: "2026-09-28",
  readingTime: "9 min read",
  author: "Devlin Duldulao",
  authorRole: "software engineer & published book author",
  authorBio:
    "Filipino fullstack developer in Norway. Has spent around 12 years building APIs for humans, and is now slightly worried that the next person to call them will be a procurement agent with better manners than most humans.",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "A2A protocol",
    "Agent2Agent",
    "A2A TypeScript",
    "A2A vs MCP",
    "Agent Card",
    "AI agent API",
    "agent to agent communication",
    "DaloyJS A2A",
    "TypeScript API framework AI agents",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const AGENT = `import { App, a2aData, a2aRoutes, bearerAuth, createA2aHandler, timingSafeEqual } from "@daloyjs/core";

const agent = createA2aHandler({
  card: {
    name: "inventory-agent",
    description: "Answers stock questions for Acme products.",
    version: "1.0.0",
    url: "https://api.acme.example/a2a",
    skills: [
      {
        id: "stock-lookup",
        name: "Stock lookup",
        description: "Units on hand for a SKU. Send { sku } as a data part.",
        tags: ["inventory"],
      },
    ],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
  },
  // You decide what a message means. DaloyJS does not guess.
  onMessage: async ({ message }) => {
    const input = message.parts.find((part) => part.data !== undefined)?.data as
      | { sku?: string }
      | undefined;
    if (!input?.sku) return { status: "rejected", message: "Send { sku } as a data part." };
    const units = await inventory.unitsFor(input.sku);
    return { status: "completed", artifacts: [{ name: "stock", parts: [a2aData({ sku: input.sku, units })] }] };
  },
});

const app = new App();
const auth = bearerAuth({ validate: (t) => timingSafeEqual(t, process.env.A2A_TOKEN!) });
for (const route of a2aRoutes("/a2a", agent, { hooks: auth })) app.route(route);`;

const WRONG_PLAN = `// What an AI-generated plan confidently told me to implement:
{ "method": "message/send", "params": { "message": { "parts": [{ "kind": "text", "text": "hi" }] } } }

// What A2A 1.0 actually says on the wire:
{ "method": "SendMessage", "params": { "message": { "role": "ROLE_USER", "parts": [{ "text": "hi" }] } } }`;

const MULTI_TURN = `const agent = createA2aHandler({
  card,
  taskStore: memoryTaskStore(), // use a shared store on serverless
  // Every task is scoped to this owner. No owner, no access: 401, not a shared bucket.
  taskOwner: ({ state }) => (state.user as { sub?: string } | undefined)?.sub,
  onMessage: ({ task, text }) => {
    if (!task) return { status: "input-required", message: "Which SKU?" };
    return { status: "completed", artifacts: [{ parts: [a2aData(lookup(text))] }] };
  },
});`;

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
            <Badge variant="outline">A2A</Badge>
            <Badge variant="outline">AI agents</Badge>
            <Badge variant="outline">Release notes</Badge>
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
            For the last year, the question in every backend meeting was some
            version of &quot;can our AI coding assistant call our API?&quot;
            DaloyJS answered that one with its built-in MCP server. Your API becomes a
            set of tools an AI client can use, with the same auth and validation
            as every other route.
          </p>

          <p>
            The next question arrived faster than I expected. It sounds like
            this: &quot;a partner&apos;s procurement agent wants to send our
            service a job and get a result back. Can it?&quot; That is not a
            tool call. That is one agent talking to another agent it does not
            share code, memory, or tools with. There is a protocol for exactly
            that, and as of 1.4.0, DaloyJS speaks it.
          </p>

          <h2>MCP and A2A are not rivals</h2>

          <p>
            People keep asking which one wins. Neither, because they answer
            different questions. Pick by who is calling.
          </p>

          <FlowDiagram
            title="Three faces of one service"
            steps={[
              {
                label: "Humans and SDKs",
                detail: "OpenAPI + typed client",
                tone: "default",
              },
              {
                label: "AI tools",
                detail: "MCP: your API as tools",
                tone: "default",
              },
              {
                label: "Other agents",
                detail: "A2A: your service as a peer",
                tone: "accent",
              },
              {
                label: "One DaloyJS app",
                detail: "same auth, same validation",
                tone: "success",
              },
            ]}
            caption="MCP is agent to tool. A2A is agent to agent. OpenAPI is still how humans and generated clients find their way around. One service can offer all three."
          />

          <p>
            If you only need an AI tool to read your inventory, you want MCP and you
            can stop reading here. If someone else&apos;s agent needs to hand
            your service a task, maybe a multi-step one that asks a follow-up
            question, you want A2A.
          </p>

          <h2>What it looks like</h2>

          <p>
            You write one function. DaloyJS handles the rest: the public Agent
            Card at <code>/.well-known/agent-card.json</code>, the JSON-RPC
            endpoint, version negotiation, validation, error codes, and the auth
            guardrails.
          </p>

          <CodeBlock code={AGENT} />

          <p>
            The <code>hooks</code> option puts auth on the JSON-RPC route only.
            The Agent Card stays public, because another agent has to read it to
            learn how to authenticate in the first place. Asking for a password
            before showing where the door is was never a great user experience,
            even for robots.
          </p>

          <h2>The decision I am happiest about: DaloyJS does not guess</h2>

          <p>
            A2A has a concept called skills. Your Agent Card lists them:
            &quot;stock lookup&quot;, &quot;reserve items&quot;, and so on. So
            the obvious design is a skill router: a message comes in, the
            framework picks the matching skill, and calls your function.
          </p>

          <p>
            There is one small problem. A2A messages do not say which skill they
            are for. The spec calls skills &quot;largely a descriptive
            concept&quot;. The protocol assumes the receiving agent reads the
            message, often in plain language, and works out what to do. A
            framework that guesses would need an LLM inside it, or a pile of
            keyword matching that will one day run &quot;delete account&quot;
            because someone wrote &quot;account&quot;.
          </p>

          <p>
            So DaloyJS does not route. Your <code>onMessage</code> function gets
            a validated message and decides. If you want an LLM to interpret
            requests, call it from your handler, where you can see it, test it,
            and blame it. The framework stays a framework. It is not an agent
            runtime, and I think that is exactly what an API framework should be.
          </p>

          <h2>An AI told me the wrong protocol, very confidently</h2>

          <p>
            Before building this, I asked an AI to research A2A and draft a
            plan. The plan was well structured, full of tables, and quietly
            written for the wrong version of the protocol.
          </p>

          <CodeBlock code={WRONG_PLAN} />

          <p>
            A2A 1.0 renamed the methods to <code>SendMessage</code>,{" "}
            <code>GetTask</code> and friends, dropped the <code>kind</code>{" "}
            field on parts, and moved the protocol version onto each interface
            in the Agent Card. The plan even had a note saying method names
            should be checked against the spec, and then used the old names on
            every page anyway. Very human behaviour, honestly.
          </p>

          <p>
            The lesson is the same one I keep relearning: an AI plan is a first
            draft, not a source of truth. DaloyJS is built against the actual
            1.0 specification, and it is tested against the official A2A
            JavaScript SDK for discovery, direct replies, multi-turn tasks,{" "}
            <code>GetTask</code>, <code>ListTasks</code>, and error mapping. The
            old <code>message/send</code> names get a clean{" "}
            <code>Method not found</code>, not a half-working imitation.
          </p>

          <h2>Secure by default, like everything else</h2>

          <p>
            An agent endpoint is a remote control for whatever your handler
            does, so it gets the same treatment as MCP:
          </p>

          <ul>
            <li>
              <strong>No auth, no boot.</strong> In production, the app refuses
              to start if the A2A endpoint has no auth hook. A genuinely public
              agent has to say so with <code>{"{ public: true }"}</code>.
            </li>
            <li>
              <strong>The card cannot lie.</strong> Streaming, push
              notifications, and the extended card are not implemented yet, so
              the card says <code>false</code> and those methods return the
              errors the spec requires. You cannot switch them on by accident.
            </li>
            <li>
              <strong>Tasks belong to someone.</strong> With a task store, every
              task is scoped to the authenticated caller. Another caller&apos;s
              task is simply &quot;not found&quot;, and an unresolved caller gets
              a 401 instead of landing in a shared bucket.
            </li>
            <li>
              <strong>HTTPS in production.</strong> Registration fails if the
              card advertises a plain <code>http:</code> URL on a public host.
            </li>
            <li>
              <strong>The boring bits are on too:</strong> body limits, strict
              UTF-8, prototype-pollution-safe parsing, an Origin check against
              DNS rebinding, and redacted internal errors.
            </li>
          </ul>

          <h2>Multi-turn tasks, when you need them</h2>

          <p>
            Most agent calls are one question, one answer, and DaloyJS is
            stateless by default so it runs happily on serverless and edge. When
            your agent needs to ask a follow-up question, add a task store:
          </p>

          <CodeBlock code={MULTI_TURN} />

          <p>
            The first message comes back as <code>input-required</code> with
            &quot;Which SKU?&quot;. The other agent answers on the same task, and
            your handler sees the stored task and finishes the job. The built-in
            memory store is fine for one instance. On serverless, a follow-up can
            land on a different instance, so bring a shared store.
          </p>

          <h2>What it does not do (yet)</h2>

          <p>
            I would rather ship a small thing that is honest than a big thing
            that is almost correct. So version one leaves out streaming, push
            notifications, the HTTP+JSON and gRPC bindings, and signed Agent
            Cards. They come when someone has work that outlives a single
            request, not because a method list looked incomplete.
          </p>

          <p>
            And no, I am not going to claim DaloyJS is the first TypeScript
            project with A2A. The official SDK and agent frameworks already have
            it. What I will claim is narrower and true: one DaloyJS app can be a
            REST API, an MCP server, and an A2A agent, with the same auth and
            validation, and no extra dependency.
          </p>

          <h2>Try it</h2>

          <p>
            Update to <code>@daloyjs/core@1.4.0</code> and read the{" "}
            <Link href={"/docs/a2a" as Route}>A2A agent endpoint docs</Link>
            {". "}If you already run the{" "}
            <Link href={"/docs/mcp" as Route}>MCP server</Link>
            {", "}you know most of it already. Same shape, different caller. The
            procurement agent is probably polite. Make it authenticate anyway.
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
