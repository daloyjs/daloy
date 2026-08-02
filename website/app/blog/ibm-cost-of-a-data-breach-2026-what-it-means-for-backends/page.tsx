import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "ibm-cost-of-a-data-breach-2026-what-it-means-for-backends",
  title:
    "IBM Cost of a Data Breach 2026: $5M Average, AI on Both Sides, and What Your Backend Still Controls",
  description:
    "Ponemon interviewed 3,500 people across 602 breached organizations. The global average hit $4.99M, AI-driven attacks are up 56%, and 92% of AI-related breaches lacked basic access controls. Here is the data, the IBM Technology walkthrough, and the backend guardrails that still move the numbers.",
  date: "2026-07-31",
  readingTime: "13 min read",
  author: "Devlin Duldulao",
  authorRole: "software engineer & published book author",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "IBM Cost of a Data Breach Report 2026",
    "Ponemon Institute data breach",
    "AI-driven attacks 2026",
    "AI access controls backend",
    "non-human identity security",
    "data breach lifecycle MTTI MTTC",
    "secure by default API",
    "DaloyJS breach cost",
    "AI agent API security",
    "encryption at rest backends",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const HOURLY_COST = `// Rough math from the report's $1,100/hour figure.
// 247 days open x 24 hours is not a fun spreadsheet.
const HOURLY_COST_USD = 1_100;
const DAYS_OPEN = 247; // MTTI + MTTC global average this year

function roughOpenCost(days = DAYS_OPEN): number {
  return days * 24 * HOURLY_COST_USD;
}

// ~$6.5M if you stay at the mean for the full lifecycle.
// Shorter detection is the lever that actually bends this curve.`;

const AI_SURFACE_OPEN = `// The shape of "we shipped an AI feature" that ends up in next year's
// report. No auth on the tool surface, no bound on who can call it,
// plugins and APIs reachable from wherever the model can reach.
app.post("/tools/refund", async (req, res) => {
  const { orderId, amountCents, reason } = req.body;
  // Whoever holds the URL can refund. The model, a prompt injection,
  // a leaked internal hop, a curious coworker on the same VPN.
  await refunds.create({ orderId, amountCents, reason });
  res.json({ ok: true });
});`;

const AI_SURFACE_CLOSED = `// Same tool surface, but the route is the contract: principal required,
// body shape fixed, response shape fixed, rate limited, egress blocked
// from walking into the metadata service.
// Progressive shorthand: app.post(path, contract, handler).
// Response contracts use body:, and handlers return { status, body }.
import { z } from "zod";
import {
  App,
  bearerAuth,
  fetchGuard,
  rateLimit,
  requestId,
  secureHeaders,
} from "@daloyjs/core";

export const app = new App()
  .use(requestId())
  .use(secureHeaders())
  .use(rateLimit({ windowMs: 60_000, max: 30 }))
  .use(
    fetchGuard({
      allow: ["https://api.stripe.com", "https://api.openai.com"],
    }),
  )
  // NHI token for the agent, not a shared human password reused across services.
  .use(
    bearerAuth({
      validate: async (token) => Boolean(await tokens.lookupAgent(token)),
    }),
  )
  .post(
    "/tools/refund",
    {
      operationId: "toolRefund",
      request: {
        body: z
          .object({
            orderId: z.uuid(),
            amountCents: z.number().int().min(1).max(50_000),
            reason: z.string().min(1).max(200),
          })
          .strict(),
      },
      responses: {
        200: {
          description: "queued",
          body: z
            .object({ id: z.uuid(), status: z.literal("queued") })
            .strict(),
        },
      },
    },
    // Auth already ran. Keep amount and shape bounds in the schema so a
    // prompt-injected agent cannot invent fields or refund $1M in one call.
    async ({ body }) => {
      const queued = await refunds.queue(body);
      return { status: 200 as const, body: queued };
    },
  );`;

const SCHEMA_GATE = `// 92% of AI-related breaches lacked basic access controls.
// Access control includes IAM in the cloud console, and also:
// which fields a caller can write, which fields a response may emit,
// and which keys a plugin is allowed to send.
import { z } from "zod";
import { App, ForbiddenError, jwk } from "@daloyjs/core";

export const app = new App()
  .use(
    jwk({
      // Asymmetric allowlist only. HS* with a JWKS source is refused at boot.
      algorithms: ["EdDSA", "ES256"],
      jwks: process.env.JWKS_URL!,
      issuer: "https://auth.example.com/",
      audience: "agent-tools",
    }),
  )
  .post(
    "/agents/:agentId/invoke",
    {
      operationId: "invokeAgent",
      request: {
        params: z.object({ agentId: z.uuid() }).strict(),
        body: z
          .object({
            tool: z.enum(["search", "summarize", "draft"]),
            input: z.string().min(1).max(4_000),
          })
          .strict(),
      },
      responses: {
        200: {
          description: "result",
          // No raw prompts, no system keys, no neighbor tenant data.
          body: z
            .object({
              tool: z.enum(["search", "summarize", "draft"]),
              output: z.string().max(8_000),
            })
            .strict(),
        },
      },
    },
    async ({ params, body, state }) => {
      const user = state.user as { sub?: string; scopes?: readonly string[] };
      if (user.sub !== params.agentId && !user.scopes?.includes("ops:agents")) {
        throw new ForbiddenError("agent scope mismatch");
      }
      const result = await agents.invoke(params.agentId, body);
      return { status: 200 as const, body: result };
    },
  );`;

const SUPPLY_CHAIN = `# Supply chain is #2 by frequency this year. For a TypeScript library
# that still means: no postinstall surprise, no hallucinated package
# name, no quiet remote install from a random host.
pnpm verify:no-lifecycle-scripts
pnpm verify:known-dep-names
pnpm verify:no-runtime-deps
pnpm verify:lockfile
pnpm verify:sbom`;

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

type BarTone = "default" | "accent" | "danger" | "success";

const BAR_TONE: Record<BarTone, string> = {
  default: "bg-muted-foreground/40",
  accent: "bg-primary",
  danger: "bg-destructive",
  success: "bg-emerald-500",
};

/**
 * Server-rendered horizontal bar chart for categorical report data.
 * No client JavaScript: each bar is a themed div whose width is a
 * percentage of {@link max}.
 */
function BarChart({
  title,
  caption,
  unit = "%",
  max = 100,
  bars,
}: {
  title: string;
  caption?: string;
  unit?: string;
  max?: number;
  bars: { label: string; value: number; tone?: BarTone }[];
}) {
  return (
    <figure className="not-prose my-8 rounded-xl border bg-card p-5 shadow-sm">
      <figcaption className="mb-4 text-sm font-semibold text-foreground">
        {title}
      </figcaption>
      <div className="flex flex-col gap-3">
        {bars.map((bar) => {
          const pct = Math.max(0, Math.min(100, (bar.value / max) * 100));
          return (
            <div
              key={bar.label}
              className="grid gap-1 sm:grid-cols-[minmax(0,13rem)_1fr] sm:items-center sm:gap-3"
            >
              <span className="text-sm text-muted-foreground">{bar.label}</span>
              <div className="flex items-center gap-2">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      BAR_TONE[bar.tone ?? "default"]
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-sm font-medium text-foreground tabular-nums">
                  {typeof bar.value === "number" && unit === "M"
                    ? bar.value.toFixed(2)
                    : bar.value}
                  {unit === "M" ? "M" : unit}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {caption ? (
        <figcaption className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Three big headline numbers in a responsive grid. */
function StatGrid({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <div className="not-prose my-8 grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border bg-card p-5 text-center shadow-sm"
        >
          <div className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
            {stat.value}
          </div>
          <div className="mt-2 text-sm leading-snug text-muted-foreground">
            {stat.label}
          </div>
        </div>
      ))}
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
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Security</Badge>
            <Badge variant="outline">AI</Badge>
            <Badge variant="outline">Field report</Badge>
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
            I watched the{" "}
            <a
              href="https://www.youtube.com/watch?v=b2PESRl7De4"
              target="_blank"
              rel="noopener noreferrer"
            >
              IBM Technology walkthrough
            </a>{" "}
            of the 2026 Cost of a Data Breach report on a quiet evening, then
            opened the PDF and started circling numbers. Same feeling as the{" "}
            <Link href="/blog/state-of-ai-security-2026-what-the-report-means-for-backends">
              Aikido / Sapio survey I wrote about earlier
            </Link>
            : the industry keeps buying tools and hiring people, and the mean
            breach still costs almost five million dollars.
          </p>

          <p>
            This one is different in shape. Aikido asked 450 teams how AI code
            and tool sprawl felt from the inside. IBM contracted the Ponemon
            Institute to interview people who already had a breach. About 602
            organizations, roughly 3,558 interviews, 17 industries, 16 countries
            and regions, breaches from March 2025 through February 2026. Extremes
            get trimmed so one mega-incident does not drag the average into
            fantasy land. Twenty-one years of the same series, so trends mean
            something.
          </p>

          <p>
            I ship backends for a living. Most of the report is about SOC
            maturity, ransomware pressure, and board-level spend. A smaller
            slice is pure API work: access controls, agent identities,
            encryption defaults, supply chain, and how long you leave a hole
            open once someone is already in. That smaller slice is where people
            like us can still move the average.
          </p>

          <div className="not-prose my-8 rounded-xl border border-primary/30 bg-primary/[0.04] p-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong className="text-foreground">
                Full disclosure, same as last time:
              </strong>{" "}
              I help build{" "}
              <a
                href="https://daloyjs.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                DaloyJS
              </a>
              , a contract-first TypeScript backend framework with security
              guardrails on by default and zero runtime dependencies. I will
              map a few findings to that stack because it is the one I know
              cold. The IBM / Ponemon numbers stand on their own. Steal the
              numbers and ignore the framework pitch if you want.
            </p>
          </div>

          <h2>The bill went up again</h2>

          <p>
            Worldwide average cost of a data breach:{" "}
            <strong>USD 4.99 million</strong>, up <strong>12%</strong> from last
            year. The US average: <strong>USD 11.5 million</strong>, more than
            double the global mean and an 11% climb of its own. The report
            translates the open window into something you can feel: about{" "}
            <strong>$1,100 for every hour</strong> a breach stays active.
          </p>

          <StatGrid
            stats={[
              {
                value: "$4.99M",
                label: "global average cost per breach (up 12%)",
              },
              {
                value: "$11.5M",
                label: "US average cost per breach",
              },
              {
                value: "$1,100",
                label: "rough cost per hour while a breach stays open",
              },
            ]}
          />

          <p>
            Detection and escalation plus lost business made up most of that
            bill (63%). Inflation alone does not explain a 12% jump after a
            slight dip last year. Somebody is getting better at staying
            invisible, or we are getting worse at noticing them, or both.
          </p>

          <CodeBlock language="ts" code={HOURLY_COST} />

          <h2>What still did not improve</h2>

          <p>
            Phishing is still number one in both cost and frequency. Voice and
            SMS phishing ran about 17% of attacks and led the cost ranking at
            roughly <strong>$5.29M</strong> per incident. Social engineering
            (help desk impersonation, MFA fatigue) sat near the top on cost.
            Supply chain compromise sat near the top on frequency. If you only
            remember three causes from this year, remember those three.
          </p>

          <BarChart
            title="Selected initial vectors by average breach cost (USD millions)"
            unit="M"
            max={6}
            bars={[
              {
                label: "Phishing (voice / SMS)",
                value: 5.29,
                tone: "danger",
              },
              {
                label: "Social engineering",
                value: 5.23,
                tone: "danger",
              },
              { label: "Abusing valid accounts", value: 5.07 },
              { label: "Supply chain compromise", value: 4.96 },
              {
                label: "Public-facing applications",
                value: 4.68,
                tone: "accent",
              },
            ]}
            caption="Source: IBM Cost of a Data Breach Report 2026 (Ponemon Institute). Global average sits at $4.99M. Phishing and social engineering still clear it."
          />

          <p>
            Mean time to identify: <strong>183 days</strong>. Mean time to
            contain after that: <strong>64 days</strong>. Add them up and you
            get <strong>247 days</strong>, about two-thirds of a year with an
            attacker somewhere in the building. That total rose six days versus
            last year and sits near the ten-year average. Internal IT teams did
            better when they found the breach themselves (209 days end to end).
            When a third party found it, the clock ran past 280 days. When the
            attacker was the one who told you, the average cost hit $5.12M.
          </p>

          <StatGrid
            stats={[
              { value: "183d", label: "mean time to identify (MTTI)" },
              { value: "64d", label: "mean time to contain (MTTC)" },
              { value: "247d", label: "full lifecycle, up 6 days YoY" },
            ]}
          />

          <p>
            Ransomware among breached organizations moved from 34% to{" "}
            <strong>39%</strong>. Encrypting systems is still a tactic (23%),
            and brand reputation threats are now the most common pressure method
            at <strong>41%</strong>. Employee PII, intellectual property,
            customer data, and even internal Slack-style comms show up in the
            extortion mix. Attackers lock disks and price your shame.
          </p>

          <h2>AI showed up on both sides of the ledger</h2>

          <p>
            More than one in four organizations in the study saw a malicious
            AI-driven attack. That is a <strong>56% increase</strong> over last
            year. Deepfake and impersonation attacks led the AI mix at{" "}
            <strong>45%</strong>. AI-enabled malware sat at 19%. When AI was
            part of the attack, average malicious breach cost rose by about{" "}
            <strong>$1 million</strong> above the non-AI baseline.
          </p>

          <BarChart
            title="Share of malicious AI attacks by type"
            unit="%"
            bars={[
              {
                label: "Deepfake / impersonation",
                value: 45,
                tone: "danger",
              },
              { label: "AI-generated phishing / comms", value: 17 },
              {
                label: "AI-enabled malware",
                value: 19,
                tone: "accent",
              },
              { label: "Other AI-driven", value: 19 },
            ]}
            caption="Source: IBM Cost of a Data Breach Report 2026. Over 25% of organizations saw a malicious AI-driven attack; deepfakes dominate the mix."
          />

          <p>
            Separately, breaches that involved the organization&apos;s own AI
            models or applications grew to <strong>21%</strong> from 13% last
            year. Among those AI-related breaches,{" "}
            <strong>92% lacked proper AI access controls</strong> (role-based
            access, MFA, the boring stuff). The expensive incidents clustered
            around model inversion (~$6.07M), prompt injection (~$5.89M), cloud
            misconfigurations around AI workloads (~$5.25M), and compromise of
            connected apps, APIs, or plugins. Open-source and third-party model
            deployments got hit at similar rates. Governance and environment
            security failed more often than the model weights did.
          </p>

          <StatGrid
            stats={[
              {
                value: "21%",
                label: "orgs with an AI model/app security incident (up from 13%)",
              },
              {
                value: "92%",
                label: "of those lacked proper AI access controls",
              },
              {
                value: "+$1M",
                label: "extra average cost when the attack itself was AI-driven",
              },
            ]}
          />

          <p>
            That 92% number is the one I keep repeating to myself. We spent a
            year arguing about model risk, and the report says the door was
            often unlocked at the API layer. Plugins, apps, cloud config. The
            same categories backend engineers already own.
          </p>

          <h2>Where automation actually saved money</h2>

          <p>
            Organizations that used security AI and automation extensively cut
            average breach cost to about <strong>$4.0M</strong> versus{" "}
            <strong>$5.93M</strong> for teams with no use. That is roughly{" "}
            <strong>$1.93 million</strong> saved. They also closed the lifecycle
            about <strong>65 days</strong> faster (215 days vs 280 for no use).
            Only 36% of breached orgs said they used these tools extensively
            across prevention, detection, investigation, and response. Half of
            orgs with a SOC have deployed AI agents there, mostly for hunting
            and response. Only <strong>18%</strong> used agents for
            vulnerability management, which is exactly where frontier models
            compress the exploit window.
          </p>

          <BarChart
            title="Breach cost by security AI / automation usage (USD millions)"
            unit="M"
            max={7}
            bars={[
              { label: "Extensive use", value: 4.0, tone: "success" },
              { label: "Limited use", value: 5.05 },
              { label: "No use", value: 5.93, tone: "danger" },
            ]}
            caption="Source: IBM Cost of a Data Breach Report 2026. Extensive use also shortened identification and containment by about 65 days versus no use."
          />

          <p>
            After organizations learned more about frontier-model threat
            capabilities, <strong>85%</strong> said they would increase security
            spending because of it. That is the rare optimistic chart in a
            report full of bad charts: money is starting to move before the
            next incident, not only after.
          </p>

          <h2>Non-human identities and the crypto hole</h2>

          <p>
            The walkthrough spends real time on non-human identities: service
            accounts, API keys, agent principals. Some industry commentary puts
            NHIs around 50:1 versus human identities in heavy automation shops.
            The report&apos;s own data is colder: less than half of breached
            organizations (46%) said they secured NHIs in AI workflows. Of those
            who did, machine identity lifecycle management led (55%), then
            secrets managers (39%), behavioral monitoring (36%), and role-based
            access (30%). Agents are ephemeral. Your identity process cannot be
            a ticket that takes three days.
          </p>

          <p>
            Encryption is still embarrassing. Only <strong>37%</strong> of
            breached organizations said sensitive data was encrypted at rest and
            in motion when the breach happened. 53% said no. 10% were not sure.
            Post-quantum prep is worse: about 26% reported a post-quantum crypto
            project. If attackers harvest ciphertext now, they can decrypt later
            when quantum or better classical attacks arrive. Crypto agility
            (rotating algorithms without rewriting the product) is the practical
            ask.
          </p>

          <h2>What a backend can still own</h2>

          <p>
            I cannot fix your SOC staffing from a TypeScript package. I can
            refuse to ship the API shape that keeps landing in the
            &quot;compromise of connected apps, APIs, or plugins&quot; bucket.
            Here is the open version of an AI tool endpoint I have seen in the
            wild more times than I want to admit:
          </p>

          <CodeBlock language="ts" code={AI_SURFACE_OPEN} />

          <p>
            There is no principal, no bound on amount, and no record of who
            called it. If a model, a prompt injection, or a lateral hop can
            reach that URL, they can refund. Shrink the report&apos;s 92%
            access-control failure to one handler and it often looks like this.
          </p>

          <p>
            Same feature with the boring controls bolted into the structure
            instead of a wiki page:
          </p>

          <CodeBlock language="ts" code={AI_SURFACE_CLOSED} />

          <p>
            Auth is required, the body is strict, and the response cannot
            smuggle extra fields. Rate limits bound blast radius. Egress is
            default-deny so a compromised process does not casually walk into
            cloud metadata. The agent has an identity you can revoke. That is
            NHI hygiene at the HTTP layer.
          </p>

          <p>
            Access control for AI surfaces includes more than &quot;is there an
            API key.&quot; It includes which tools exist, which arguments they
            accept, and which fields ever leave the process:
          </p>

          <CodeBlock language="ts" code={SCHEMA_GATE} />

          <p>
            On supply chain, the report&apos;s frequency ranking matches what we
            already gate in CI for libraries people install into production
            APIs:
          </p>

          <CodeBlock language="bash" code={SUPPLY_CHAIN} />

          <p>
            Binary gates beat homework. A named failing check is something you
            fix. A 40-item scanner queue is something you learn to dismiss. The
            Aikido survey already showed what that costs in false-positive
            fatigue.
          </p>

          <h2>Report finding to backend default</h2>

          <div className="not-prose my-8 overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-3 font-semibold text-foreground">
                    What IBM / Ponemon found
                  </th>
                  <th className="p-3 font-semibold text-foreground">
                    What a secure-by-default backend can enforce
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    found:
                      "92% of AI-related breaches lacked proper access controls; apps/APIs/plugins were common entry points",
                    daloy:
                      "Auth middleware (jwk() with asymmetric algorithm allowlists, bearerAuth, etc.) plus per-route schemas so tools only accept declared fields. MCP routes refuse to boot unauthenticated unless you opt out on purpose.",
                  },
                  {
                    found:
                      "AI-driven attacks add ~$1M; deepfakes and AI malware compress attacker time",
                    daloy:
                      "You cannot stop a deepfake CFO call from TypeScript. You can rate-limit sensitive routes, require short-lived tokens, and keep side effects behind strict schemas so a rushed operator cannot grant god-mode with one bad request.",
                  },
                  {
                    found:
                      "247-day lifecycle; every hour open costs ~$1,100",
                    daloy:
                      "requestId + structured logs + OTel hooks make correlation boring and fast. Fail closed on body size and timeouts so a stuck process does not sit invisible for weeks.",
                  },
                  {
                    found:
                      "Supply chain compromise remains a top-frequency vector",
                    daloy:
                      "Zero runtime deps on @daloyjs/core, ignore-scripts posture in templates, verify:* gates for lifecycle scripts, known package names, lockfile sources, and SBOM generation.",
                  },
                  {
                    found:
                      "Only 37% had sensitive data encrypted at breach time",
                    daloy:
                      "Your database encryption is still on you. The framework can refuse to log secrets (redactRecord), refuse to emit undeclared response fields, and keep cookies on __Host- + Secure + HttpOnly defaults so session material is harder to steal in transit.",
                  },
                  {
                    found:
                      "NHIs in AI workflows often unsecured; agents need ephemeral, automated identity",
                    daloy:
                      "Treat agents as first-class principals: bearer/jwk auth per agent, scoped routes, exp-checked tokens, timingSafeEqual for shared secrets. No long-lived shared service password in three services.",
                  },
                  {
                    found:
                      "Extensive security AI/automation saves ~$1.93M and 65 days",
                    daloy:
                      "Automation here means gates in CI and defaults in the runtime. Pass/fail checks and schema validation produce signal instead of a triage queue.",
                  },
                ].map((row) => (
                  <tr
                    key={row.found}
                    className="border-b border-border/60 align-top last:border-0"
                  >
                    <td className="p-3 text-muted-foreground">{row.found}</td>
                    <td className="p-3">{row.daloy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>What I would do on Monday</h2>

          <ul>
            <li>
              Inventory every HTTP surface a model or agent can call. If it can
              move money, data, or identity, it needs a principal, a schema, and
              a rate limit. No shared god keys.
            </li>
            <li>
              Treat AI plugins and tool bridges as public-facing APIs, even when
              they live on a private network. The report keeps finding the hole
              in the connector layer.
            </li>
            <li>
              Measure your own open window. You may not have Ponemon&apos;s
              $1,100/hour, but you have detection lag. Put a real number on it
              before the next budget meeting.
            </li>
            <li>
              Encrypt sensitive fields and plan crypto agility. The 37% figure
              means a lot of teams still ship plaintext because encryption was
              a later ticket.
            </li>
            <li>
              Prefer automation that shortens time-to-fix over tools that only
              lengthen the alert queue. The $1.93M savings sat with people who
              used AI and automation extensively in the security lifecycle.
              Buying another unread dashboard does not produce that number.
            </li>
          </ul>

          <p>
            A framework will not stop phishing, negotiate ransomware, or staff
            your SOC. It can stop the boring failures that keep sitting next to
            the scary AI headlines: open tool routes, mass assignment, secret
            leakage in responses, unscoped agent tokens, and supply-chain
            install surprises. Those still fit in a pull request.
          </p>

          <p>
            Attackers already use AI to shrink the window between discovery and
            exploit. Defenders get the same tools, and they still need the
            unglamorous ones: identity, schemas, encryption, and supply-chain
            gates. The report spends 36 pages showing those still move cost.
          </p>

          <div className="not-prose my-8 rounded-xl border bg-muted/30 p-6">
            <p className="text-base font-semibold text-foreground">
              Sources and next reads
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                <a
                  href="https://www.youtube.com/watch?v=b2PESRl7De4"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  IBM Technology: 2026 Cost of a Data Breach Report (video)
                </a>
              </li>
              <li>
                IBM Cost of a Data Breach Report 2026 (Ponemon Institute study of
                602 organizations, ~3,558 interviews)
              </li>
              <li>
                Earlier field note:{" "}
                <Link href="/blog/state-of-ai-security-2026-what-the-report-means-for-backends">
                  State of AI in Security 2026
                </Link>
              </li>
              <li>
                <Link href="/docs/security/secure-defaults">
                  DaloyJS secure-by-default guide
                </Link>
              </li>
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              If you want the defaults already on:
            </p>
            <div className="mt-3">
              <CodeBlock
                language="bash"
                code="pnpm create daloy@latest my-api"
              />
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}
