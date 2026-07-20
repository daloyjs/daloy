import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { FlowDiagram } from "@/components/diagram";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "state-of-ai-security-2026-what-the-report-means-for-backends",
  title:
    "The State of AI in Security 2026: 450 Teams, One Uncomfortable Pattern, and What Your Backend Can Do About It",
  description:
    "Aikido and Sapio Research surveyed 450 developers, CISOs, and AppSec engineers across Europe and the US. The headline: AI now writes a quarter of production code, 1 in 5 teams had a serious incident because of it, and the usual reflex (buy more tools) makes things measurably worse. Here is the data, with charts, and the structural lesson it points to for anyone shipping an API.",
  date: "2026-06-25",
  readingTime: "14 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "State of AI in Security 2026",
    "Aikido report",
    "AI generated code vulnerabilities",
    "security tool sprawl",
    "false positive fatigue",
    "automated security gates",
    "secure by default backend",
    "DaloyJS AI security",
    "AppSec CloudSec consolidation",
    "AI code incident rate",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const AI_HANDLER = `// What a coding assistant happily produced for me when I asked it
// to "add an endpoint to update a user's plan". It runs. The demo
// works. The PR looks fine at a glance. Ship it, right?
app.post("/users/:id/plan", async (req, res) => {
  const { id } = req.params;
  const body = req.body; // trust me, it's fine

  const updated = await db.user.update({
    where: { id },
    // Mass assignment: nothing stops body.role = "admin" or
    // body.isVerified = true from being written straight to the row.
    data: body,
  });

  // And the response hands back the whole record, including
  // passwordHash and internal feature flags, to whoever called it.
  res.json(updated);
});`;

const DALOY_HANDLER = `// Same feature, but the route IS the contract. The handler never
// runs unless the request matches, and the response physically
// cannot carry a field you did not declare. An AI can write this
// just as fast. The difference is the guardrail is structural,
// not a comment someone hopefully leaves in code review.
import { z } from "zod";
import { App } from "@daloyjs/core";

export const app = new App();

app.route({
  method: "POST",
  path: "/users/:id/plan",
  operationId: "updateUserPlan",
  request: {
    params: z.object({ id: z.uuid() }).strict(),
    body: z
      .object({
        plan: z.enum(["free", "pro", "team"]),
        seatCount: z.number().int().min(1).max(500),
      })
      // Unknown keys (role, isAdmin, isVerified) are rejected with a
      // 400, not silently merged into the update.
      .strict(),
  },
  responses: {
    200: {
      description: "updated",
      // Only these three fields can ever leave the building.
      // passwordHash is not on the list, so it cannot leak even if
      // a junior dev adds it to the SELECT next quarter.
      schema: z
        .object({
          id: z.uuid(),
          plan: z.enum(["free", "pro", "team"]),
          seatCount: z.number().int(),
        })
        .strict(),
    },
  },
  handler: async ({ params, body }) => billing.setPlan(params.id, body),
});`;

const COST_SNIPPET = `// The report's $20M line, made concrete. Engineers spend ~6.1 hours
// a week triaging tool output, and 72% of that time goes to false
// positives. Plug in your own blended rate and team size.
const HOURS_PER_WEEK = 6.1;
const FALSE_POSITIVE_SHARE = 0.72;
const WORKING_WEEKS = 46;
const BLENDED_HOURLY_USD = 75; // illustrative

function noiseCostPerEngineer(): number {
  const wastedHours = HOURS_PER_WEEK * FALSE_POSITIVE_SHARE * WORKING_WEEKS;
  return Math.round(wastedHours * BLENDED_HOURLY_USD);
}

// ~$15,000 per engineer per year, spent reading alerts that were
// never real. At 1,000 engineers that is the report's ~$20M figure,
// and not one line of it shipped a feature.`;

const GATES_SNIPPET = `# The report's clearest signal: automated gates in CI beat manual
# review, and tools that serve devs AND security beat single-audience
# tools. A DaloyJS repo leans into both. These run in CI and in the
# framework's own publish pipeline, and they fail closed.

pnpm verify:no-lifecycle-scripts   # no transitive postinstall hooks
pnpm verify:known-dep-names        # no slopsquatted / hallucinated names
pnpm verify:no-runtime-deps        # zero runtime deps to audit
pnpm verify:lockfile               # registry-only sources, pinned

# Each is a binary pass/fail with a named offender. There is no
# "severity: medium, 14 findings, please triage" queue to ignore.`;

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
 * Server-rendered, responsive horizontal bar chart for categorical
 * survey data. No client JavaScript: each bar is a themed div whose
 * width is a percentage of {@link max}. Labels stack above the track
 * on narrow screens and sit beside it from `sm:` up.
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
                <span className="w-14 shrink-0 text-right font-mono text-sm font-medium text-foreground tabular-nums">
                  {bar.value}
                  {unit}
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
              ← Back to blog
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
            Someone dropped Aikido&apos;s{" "}
            <a
              href="https://www.aikido.dev/state-of-ai-security-development-2026"
              target="_blank"
              rel="noopener noreferrer"
            >
              State of AI in Security &amp; Development 2026
            </a>{" "}
            report in our team chat with the comment &ldquo;this is just us, but
            with numbers.&rdquo; I read all 52 slides on a train ride, and yeah,
            it was uncomfortable in the way good data usually is.
          </p>

          <p>
            The setup: Sapio Research surveyed 450 full-time professionals
            across Europe and the US, split evenly into 150 developers, 150
            security leaders (CISOs or equivalent), and 150 application security
            engineers. So this is not a vendor asking its own happy customers
            whether they are happy. It is a cross-section of the people writing
            code, the people reviewing it, and the people who get the 2 a.m.
            phone call when it goes wrong.
          </p>

          <p>
            I have shipped backends for about twelve years now, and I have lived
            most of this report. The part that stuck with me is not any single
            scary number. It is the loop: AI writes more of our code, incidents
            go up, and the instinctive fix (buy another scanner) makes the
            problem measurably worse. Let me walk through the data, and then the
            structural lesson it points to. The lesson is not &ldquo;use our
            framework,&rdquo; it is something more boring and more durable. But
            since one concrete way to apply that lesson is the thing I work on,
            let me be upfront about it.
          </p>

          <div className="not-prose my-8 rounded-xl border border-primary/30 bg-primary/[0.04] p-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              <strong className="text-foreground">
                New here, and full disclosure:
              </strong>{" "}
              I help build{" "}
              <a
                href="https://daloyjs.dev"
                target="_blank"
                rel="noopener noreferrer"
              >
                DaloyJS
              </a>
              {", "}so weigh the framework parts accordingly. If you have not
              run into it yet: DaloyJS is a new, contract-first TypeScript
              backend framework. You define a route once and get request and
              response validation, live OpenAPI docs, a fully typed client, and
              security guardrails that are <strong>on by default</strong>
              {", "}with <strong>zero runtime dependencies</strong>
              {", "}running on Node, Bun, Deno, Cloudflare, and Vercel. That is
              the lens I read this report through. I will keep the data and the
              framework clearly separated, so you can take the numbers and
              ignore me if you like.
            </p>
          </div>

          <h2>AI is writing a quarter of your code, and it shows</h2>

          <p>
            Start with adoption. AI coding tools now write{" "}
            <strong>24% of production code</strong> on average, 21% in Europe
            and 29% in the US. That is not autocomplete anymore. That is a
            junior developer who never sleeps, never asks questions, and
            confidently commits whatever pattern was most common in its training
            data.
          </p>

          <StatGrid
            stats={[
              {
                value: "69%",
                label:
                  "of orgs have found a vulnerability introduced by AI-generated code",
              },
              {
                value: "1 in 5",
                label:
                  "suffered a serious incident directly tied to AI-generated code",
              },
              {
                value: "24%",
                label: "of production code is now written by AI tools",
              },
            ]}
          />

          <p>
            Nearly 70% of organizations say they have uncovered flaws tied to
            AI-generated code. For one in five, it escalated into a serious
            breach. Here is the full breakdown of how teams answered &ldquo;have
            you ever identified a vulnerability introduced by AI-generated
            code?&rdquo;
          </p>

          <BarChart
            title="Vulnerabilities introduced by AI-generated code"
            unit="%"
            bars={[
              { label: "Yes, a minor issue", value: 49, tone: "accent" },
              { label: "Yes, a serious incident", value: 20, tone: "danger" },
              { label: "Not aware of any", value: 20 },
              { label: "No, none", value: 11, tone: "success" },
            ]}
            caption="Source: State of AI in Security & Development 2026 (Aikido / Sapio Research, n=450). The 20% who are 'not aware' worry me more than the 20% who had an incident."
          />

          <p>
            I want to be fair to the AI here. The code it writes usually works.
            That is exactly the trap. The vulnerability is rarely a syntax error
            a linter catches. It is the missing authorization check, the
            mass-assignment, the response that returns the whole row. Here is a
            real shape of it, the kind of thing I have genuinely had to send
            back:
          </p>

          <CodeBlock language="ts" code={AI_HANDLER} />

          <p>
            Three bugs, zero of them visible in a quick scroll. No input
            validation, so the request body becomes the database write. Mass
            assignment, so <code>role</code> and <code>isVerified</code> are
            fair game. And the response serializes the entire user record,
            <code>passwordHash</code> included. The demo works. The tests, if
            there are any, probably pass. This is what &ldquo;the code
            runs&rdquo; buys you now.
          </p>

          <h2>The optimism gap is doing a lot of heavy lifting</h2>

          <p>
            Here is where the report gets a little funny. Despite all of the
            above, <strong>96%</strong> of organizations believe AI will one day
            write near-perfect secure code. The average timeline they give is
            5.1 years. I admire the confidence. I do not share it, and neither,
            on closer reading, do they.
          </p>

          <BarChart
            title="When will AI write near-perfect secure code?"
            unit="%"
            bars={[
              { label: "Within 1-2 years", value: 20 },
              { label: "3-5 years", value: 44, tone: "accent" },
              { label: "6-10 years", value: 24 },
              { label: "More than 10 years", value: 8 },
              { label: "Never", value: 4, tone: "danger" },
            ]}
            caption="Most teams expect a 3-5 year horizon, but only 21% believe it will ever happen without human oversight."
          />

          <p>
            Only <strong>21%</strong> think AI will get there without a human in
            the loop. The other 79%, as one of the report&apos;s quoted CISOs
            puts it, are &ldquo;the smart ones.&rdquo; Almost a third expect AI
            to reduce bugs but still need people for secure design,
            architecture, and the business logic that no model understands
            because it lives in your head and a Slack thread from 2024.
          </p>

          <p>
            Meanwhile <strong>90%</strong> expect AI to take over penetration
            testing within about 5.5 years, and 97% would at least consider an
            agentic AI pentest tool. But they want proof: 60% want side-by-side
            results against a manual pentest before they trust it. Translation:
            everyone believes in the future and nobody is willing to bet
            production on it yet. That is the correct posture, and it is the
            same posture you should have toward the AI writing your endpoints
            today.
          </p>

          <h2>Tool sprawl is an incident generator, not an incident fix</h2>

          <p>
            This is the section I would tattoo on the wall of every security org
            that responds to a scare by signing another contract. The data is
            blunt: teams that suffered an incident in the past year ran{" "}
            <strong>more</strong> security tools (5.1 on average) than teams
            that did not (4.2). And it runs both directions. More tools
            correlated with more incidents, even after accounting for company
            size.
          </p>

          <BarChart
            title="Hours per week spent triaging security tool alerts"
            unit="h"
            max={10}
            bars={[
              { label: "1-2 tools", value: 4.1, tone: "success" },
              { label: "3-5 tools", value: 5.6 },
              { label: "5+ tools", value: 7.8, tone: "danger" },
            ]}
            caption="Mean across all teams: 6.1 hours per engineer per week, just on triage."
          />

          <p>
            The mechanism is not mysterious. Every tool you add is another alert
            stream, another dashboard, another set of false positives, and
            another integration that does not quite line up with the others. 93%
            of teams running separate application-security and cloud-security
            tools report integration headaches: duplicate alerts, inconsistent
            data, findings that do not connect across tools. And the incident
            rate follows:
          </p>

          <BarChart
            title="Material incident rate: split vs integrated AppSec + CloudSec"
            unit="%"
            bars={[
              {
                label: "Separate AppSec / CloudSec tools",
                value: 31,
                tone: "danger",
              },
              {
                label: "Integrated into one platform",
                value: 20,
                tone: "success",
              },
            ]}
            caption="Teams that split application and cloud security were 50% more likely to report an incident (31% vs 20%)."
          />

          <p>
            Remediation gets slower too. With a small stack, teams average a
            little over 3 days to fix a critical vulnerability. For teams
            juggling five or more vendor tools, that stretches to almost 8 days.
            Every extra tool adds alerts and integration overhead, and the path
            to &ldquo;actually fixed&rdquo; gets longer, not shorter.
          </p>

          <h2>The $20M tax nobody puts on a slide deck</h2>

          <p>
            The report does the math I usually avoid because it depresses me.
            Engineers spend around 6 hours a week triaging security alerts.
            Based on US Bureau of Labor Statistics salary data, that is roughly{" "}
            <strong>$20,000 per developer per year</strong> in lost
            productivity. And <strong>72%</strong> of that time goes to false
            positives.
          </p>

          <StatGrid
            stats={[
              {
                value: "15%",
                label: "of engineering time lost to triaging alerts",
              },
              { value: "72%", label: "of that time wasted on false positives" },
              {
                value: "~$20M",
                label: "annual cost for a 1,000-developer org",
              },
            ]}
          />

          <p>
            If you want to feel it in your own terms instead of a press-release
            number, here is the same calculation as code. Swap in your blended
            rate and headcount:
          </p>

          <CodeBlock language="ts" code={COST_SNIPPET} />

          <p>
            For a 50-person engineering org that is about $1M a year. For 250,
            about $5M. The point is not the precision, it is the category: this
            is a real, recurring cost that scales with headcount, and most of it
            is spent reading alerts that were never real. That is the invoice
            tool sprawl sends you every year.
          </p>

          <h2>False positives make good engineers do dumb things</h2>

          <p>
            Here is the human cost, which is worse than the dollar cost.{" "}
            <strong>65%</strong> of respondents admit that false positives have
            pushed them into risky behavior: bypassing security checks,
            dismissing findings, or delaying fixes. In the US that climbs to
            73%. I have been the engineer who clicked &ldquo;dismiss&rdquo; on a
            wall of yellow because I had a release to ship and the last forty
            alerts were noise. The forty-first might not have been. That is how
            this goes.
          </p>

          <FlowDiagram
            title="The tool-sprawl doom loop"
            numbered
            steps={[
              {
                eyebrow: "trigger",
                label: "Incident or scare",
                detail: "board asks 'what are we doing about AI?'",
              },
              {
                eyebrow: "reflex",
                label: "Buy another tool",
                detail: "now 5+ scanners, each its own dashboard",
                tone: "accent",
              },
              {
                eyebrow: "result",
                label: "More alerts, more noise",
                detail: "98% report false positives, ~4.8h/week each",
              },
              {
                eyebrow: "human",
                label: "Fatigue and bypass",
                detail: "65% dismiss, delay, or skip checks",
                tone: "danger",
              },
              {
                eyebrow: "outcome",
                label: "Real bug slips through",
                detail: "incident rate rises, go to step 1",
                tone: "danger",
              },
            ]}
            caption="The loop feeds itself: each incident justifies another tool, each tool adds noise, the noise trains people to ignore alerts, and the next real finding gets ignored with the rest."
          />

          <p>
            The way out of this loop is not heroics or another vendor. It is
            cutting the noise at the source so the alerts that survive are worth
            reading. Hold that thought, because it is the whole point.
          </p>

          <h2>Europe prevents, the US reacts</h2>

          <p>
            One of the more interesting splits in the report is regional.
            European orgs report far fewer serious incidents than US peers (20%
            vs 43%), but more near misses (53% vs 40%). The reading the report
            offers, and I find it convincing, is that Europe is catching things
            earlier in the pipeline while the US is catching them in production.
          </p>

          <BarChart
            title="Serious incidents vs near misses, by region"
            unit="%"
            bars={[
              { label: "Serious incident (EU)", value: 20, tone: "success" },
              { label: "Serious incident (US)", value: 43, tone: "danger" },
              { label: "Near miss (EU)", value: 53, tone: "accent" },
              { label: "Near miss (US)", value: 40 },
            ]}
            caption="A near miss is a finding caught before it became serious. More near misses and fewer incidents is the shape of catching things early."
          />

          <p>
            Several factors feed it: stronger regulatory pressure in Europe, US
            teams more likely to dismiss alerts or delay fixes (73% vs 61%), and
            heavier US reliance on AI-generated code (29% vs 21%). The US is
            further ahead on AI adoption and visibility, which is also why it
            reports more AI-related vulnerabilities. Being out in front means
            you see more of the problem. Europe just shifted more of the
            catching to the left, before code ships.
          </p>

          <h2>What actually moves the needle: automated gates and DevEx</h2>

          <p>
            Now the constructive part, because the report does not just catalog
            pain. It is unusually clear about what correlates with{" "}
            <em>fewer</em> incidents, and there are two findings that matter.
          </p>

          <p>
            First, <strong>automated gates beat manual review</strong>. 56% of
            teams use automated gates (PR checks, CI/CD), 46% still lean on
            manual reviews, and 42% mainly rely on developers spotting issues
            themselves. The report is direct that human review does not scale to
            the volume and speed AI produces, and that automation is the
            stronger guardrail. Where automated gates are in place, teams ship
            faster with fewer missed issues.
          </p>

          <p>
            Second, and this is the one I think most people miss,{" "}
            <strong>
              tools built for both developers and security teams have the lowest
              incident rates
            </strong>
            {". "}Tools that serve only one audience leave the other side
            fighting the tooling instead of the threat.
          </p>

          <BarChart
            title="Material incident rate by who the tools are built for"
            unit="%"
            bars={[
              {
                label: "Tools for both devs + security",
                value: 22,
                tone: "success",
              },
              { label: "Tools built mainly for developers", value: 30 },
              {
                label: "Tools built mainly for security",
                value: 33,
                tone: "danger",
              },
            ]}
            caption="Teams whose tools serve both sides also fix critical vulnerabilities within 24 hours far more often (59%) than developer-first setups (14%)."
          />

          <p>
            Read those two findings together and you get a design spec:{" "}
            <em>
              automated, in-pipeline guardrails that developers and security
              people can both live with, and that produce signal instead of
              noise.
            </em>{" "}
            That is not a product pitch. It is a way of building. It happens to
            be the way I build APIs now, so let me show you what it looks like
            in practice rather than wave my hands.
          </p>

          <h2>What this looks like in a backend you ship</h2>

          <p>
            Go back to that insecure AI-generated handler. The fix is not
            &ldquo;review harder.&rdquo; Review is the thing that does not
            scale. The fix is to make the contract enforceable so the unsafe
            version cannot exist. Here is the same endpoint where the route
            definition is the guardrail:
          </p>

          <CodeBlock language="ts" code={DALOY_HANDLER} />

          <p>
            Notice what changed. The validation is not a separate step a busy
            developer might skip, it is part of the route. Unknown keys are
            rejected, so mass assignment is gone. The response schema means
            <code>passwordHash</code> cannot leak, even by accident, even next
            quarter. An AI assistant can generate this just as quickly as the
            unsafe version. The difference is that the safe shape is the default
            shape, so the AI&apos;s confident-but-wrong instinct has nowhere to
            land. That is what &ldquo;secure by default&rdquo; actually means:
            not a checklist you remember, a baseline you cannot forget.
          </p>

          <p>
            On the false-positive problem, the report&apos;s lesson is to favor
            automated gates that produce clear signal over scanners that produce
            triage queues. The supply-chain side of a DaloyJS repo is built that
            way on purpose:
          </p>

          <CodeBlock language="bash" code={GATES_SNIPPET} />

          <p>
            Each of these is a binary pass or fail with a named offender. There
            is no &ldquo;14 findings, severity medium, please assess&rdquo;
            queue that trains you to click dismiss. That is the difference
            between a gate and a scanner: a gate tells you exactly what to fix
            and refuses to let it through, a scanner gives you homework. The
            report is full of teams drowning in homework.
          </p>

          <p>
            And on the &ldquo;tools for both devs and security&rdquo; point: the
            same contract that gives a developer typed handlers and a generated
            client is the artifact a security reviewer reads to see exactly what
            every endpoint accepts and returns. One source of truth, two
            audiences, no second tool. That is the cheap version of the
            integration the report says reduces incidents.
          </p>

          <p>
            If you want the whole thing on one screen, here is the report&apos;s
            pain mapped to what an app on <code>@daloyjs/core</code> does about
            it out of the box, no extra config and no extra tool:
          </p>

          <div className="not-prose my-8 overflow-x-auto rounded-xl border">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-3 font-semibold text-foreground">
                    What the report found
                  </th>
                  <th className="p-3 font-semibold text-foreground">
                    What DaloyJS does by default
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    found:
                      "AI code skips input validation and mass-assigns fields",
                    daloy:
                      "The request schema runs before the handler. .strict() rejects unknown keys with a 400, so role or isAdmin cannot be smuggled into a write.",
                  },
                  {
                    found: "AI code returns whole records and leaks fields",
                    daloy:
                      "Response schemas are validated on the way out. A field you did not declare (like passwordHash) physically cannot leave the endpoint.",
                  },
                  {
                    found:
                      "Tool sprawl: separate dashboards for devs and security",
                    daloy:
                      "One OpenAPI 3.1 contract is the single source for both audiences, and the typed client is generated from it. Nothing to reconcile across tools.",
                  },
                  {
                    found:
                      "False-positive fatigue (65% bypass or dismiss checks)",
                    daloy:
                      "The verify:* gates are binary pass/fail with a named offender. No 'severity: medium, 14 findings' queue to learn to ignore.",
                  },
                  {
                    found:
                      "Manual review does not scale to AI speed and volume",
                    daloy:
                      "Gates run in CI and fail closed. Body limits, secureHeaders, and prod-mode error redaction hold without a reviewer remembering them.",
                  },
                  {
                    found: "Slow remediation with large dependency stacks",
                    daloy:
                      "@daloyjs/core ships zero runtime dependencies, so there is far less to audit, patch, or chase a CVE through.",
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

          <p>
            None of that is exotic, and none of it is a paid add-on. It is the
            default shape of a route, which is the whole idea: the report keeps
            showing that the safe path loses whenever it is the extra step. So
            DaloyJS makes the safe path the only path that is also the easy one.
          </p>

          <h2>So what do I actually do on Monday?</h2>

          <p>
            You do not need to adopt anything I work on to act on this report.
            The lessons are structural. If I had to compress 52 slides into four
            things worth doing this week:
          </p>

          <ul>
            <li>
              <strong>Treat AI-generated code as untrusted input.</strong> Put
              an enforced contract in front of every side effect, validate the
              request before the handler runs, and validate the response on the
              way out. The model is a fast, confident junior. Supervise it with
              code, not with hope.
            </li>
            <li>
              <strong>Stop equating more tools with more security.</strong> The
              data says the opposite. Before you buy the next scanner, ask
              whether it produces gates or homework, and whether it adds a
              dashboard your team will learn to ignore.
            </li>
            <li>
              <strong>Move your checks into the pipeline.</strong> Automated
              gates in CI beat manual review at AI speed and volume. A check
              that fails the build is worth ten that file a ticket.
            </li>
            <li>
              <strong>Measure the false-positive tax.</strong> Run the cost
              snippet above with your real numbers. Once &ldquo;noise&rdquo; has
              a dollar figure, consolidating tools stops being a nice-to-have.
            </li>
          </ul>

          <p>
            The honest caveat, since I promised this would not be a pitch: no
            framework, mine included, fixes most of this. Secure design, the
            architecture decisions, the business logic, and the judgment calls
            still need humans. That is literally what the report&apos;s 79%
            believe, and they are right. What a framework can do is make the
            safe path the default path so your scarce human attention goes to
            the hard problems instead of the ones a schema should have caught.
            That is a smaller claim than &ldquo;we fix AI security,&rdquo; and
            it is also the exact category the report shows hurting teams the
            most.
          </p>

          <div className="not-prose my-8 rounded-xl border bg-muted/30 p-6">
            <p className="text-base font-semibold text-foreground">
              Want to try the secure-by-default approach?
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              DaloyJS is free, MIT-licensed, and zero-runtime-dependency. One
              command scaffolds a typed, validated, OpenAPI-documented API with
              the guardrails in this post already switched on:
            </p>
            <div className="mt-4">
              <CodeBlock
                language="bash"
                code="pnpm create daloy@latest my-api"
              />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Start with the{" "}
              <a
                href="https://daloyjs.dev/docs/security/secure-defaults"
                target="_blank"
                rel="noopener noreferrer"
              >
                secure-by-default guide
              </a>{" "}
              or the{" "}
              <a
                href="https://daloyjs.dev/docs"
                target="_blank"
                rel="noopener noreferrer"
              >
                docs
              </a>
              {". "}It is genuinely new, so kick the tires and tell me where it
              breaks. I would rather hear it from you than read about it in next
              year&apos;s report.
            </p>
          </div>

          <p>
            AI is going to keep writing more of our code. The report is
            clear-eyed that this is not slowing down. The teams that do well
            will not be the ones with the most tools or the most faith in the
            model. They will be the ones who made the secure thing the easy
            thing, automated the boring checks, and protected their
            engineers&apos; attention like the expensive resource it is. That is
            not a 2026 trend. That is just good engineering, and it is nice to
            finally have 450 teams worth of data saying so.
          </p>

          <p className="text-sm text-muted-foreground">
            Data throughout this post is from Aikido and Sapio Research&apos;s{" "}
            <a
              href="https://www.aikido.dev/state-of-ai-security-development-2026"
              target="_blank"
              rel="noopener noreferrer"
            >
              State of AI in Security &amp; Development 2026
            </a>{" "}
            (survey of 450 developers, security leaders, and AppSec engineers
            across Europe and the US). The charts are my rendering of the
            report&apos;s figures.
          </p>
        </div>
      </article>
    </main>
  );
}
