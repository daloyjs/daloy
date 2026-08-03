import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "daloyjs-1-0-0-the-bugs-were-in-the-wiring",
  title: "DaloyJS 1.0.0 Is Out, and Almost Every Late Bug Was in the Wiring",
  description:
    "The API is frozen and semver starts now. The interesting part of getting here: nine release candidates of live pentesting, where the findings were almost never inside a middleware. They were between two of them, in the order I told people to mount them.",
  date: "2026-08-03",
  readingTime: "9 min read",
  author: "Devlin Duldulao",
  authorRole: "software engineer & published book author",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  image: `/blog/${POST.slug}/opengraph-image`,
  keywords: [
    "DaloyJS 1.0.0",
    "TypeScript API framework stable release",
    "middleware ordering bug",
    "responseCache rate limit bypass",
    "X-Forwarded-For spoofing",
    "hook phase preBody beforeHandle",
    "refuse to boot guard",
    "middleware composition security",
    "semver public API freeze",
    "idempotency Set-Cookie replay",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const CACHE_ORDER = `// Both of these are correct on their own.
// Together, in this order, the second one stops existing.
const app = new App({ env: "production" });

app.use(responseCache({ ttlSeconds: 30 }));   // answers from beforeHandle
app.use(geoBlock({ deny: ["XX"] }));          // used to enforce in beforeHandle

// Request 1 from an allowed country: 200, and the body gets cached.
// Request 2 from a denied country: 200, the cached body, "x-cache: HIT".
// The gate never ran. Nothing in the response says a gate was skipped.`;

const LIMITER_ORDER = `// Same shape, different victim. rateLimit also enforces in beforeHandle.
app.use(responseCache({ ttlSeconds: 30 }));
app.use(rateLimit({ windowMs: 60_000, max: 2 }));

// Six identical requests, max: 2.
// I expected 200, 200, 429, 429, 429, 429.
// I measured 200, 200, 200, 200, 200, 200.`;

const BOOT_GUARD = `// 1.0.0 refuses this at boot in production instead of letting it look fine.
//
// Route GET /products runs responseCache() before rateLimit() / loginThrottle()
// in its effective hook chain. Both act from beforeHandle, so a cache hit or an
// idempotent replay returns a response and ends the chain before the limiter
// counts the request. Register rateLimit() first.

// The fix is one line of ordering, which is the point of failing loudly.
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.use(responseCache({ ttlSeconds: 30 }));`;

const XFF = `// A load balancer in append mode gives you this:
//   X-Forwarded-For: <whatever the client sent>, <what the LB actually saw>
//
// So reading position zero reads the attacker.
const client = xff.split(",")[0].trim();   // what I had

// Rotate one spoofed left-hand entry per attempt and every failed login looks
// like a brand new IP, so the strike counter never reaches maxStrikes. Or put
// somebody else's address there and get them banned instead.

// 1.0.0 counts hops from the right, the side your own proxies wrote:
app.use(autoBan({ trustedHops: 2 }));  // CDN -> LB -> app`;

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
              &lt;- Back to blog
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Release</Badge>
            <Badge variant="outline">1.0.0</Badge>
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
            DaloyJS 1.0.0 is published. The public API is frozen, semver applies
            from here, no 1.x minor changes the API, and deprecations get at
            least one minor cycle before anything disappears.{" "}
            <code>@daloyjs/core</code> and <code>create-daloy</code> are on npm,{" "}
            <code>@daloyjs/daloy</code> is on JSR, all at the same version, so a
            scaffolded project always pins a peer that actually exists. The 1.x
            line has a minimum 5-year security-update window, which for this
            release means August 2031.
          </p>
          <p>
            That is the announcement part. What I actually want to write about is
            what happened during the nine release candidates, because it changed
            how I test this thing.
          </p>

          <h2>I was looking in the wrong place</h2>
          <p>
            The second half of the RC train was driven by live attacks against a
            real server instead of a plan. I booted the framework, pointed a
            harness at it over TCP, and worked through attack classes. My mental
            model going in was that bugs live inside modules. A parser mishandles
            an encoding. A comparison is not constant time. A regex misses a
            case. So that is where I looked.
          </p>
          <p>
            Almost nothing was there. Every high-severity finding in the last
            stretch was sitting between two modules that were each correct by
            themselves, and in most cases the wiring that produced it was the
            wiring my own documentation recommended.
          </p>

          <h2>The one that made me put my coffee down</h2>
          <p>
            DaloyJS has five middlewares that decide whether a request is allowed
            based on network identity: <code>geoBlock()</code>,{" "}
            <code>ipRestriction()</code>, <code>botGuard()</code>,{" "}
            <code>autoBan()</code>, and <code>ipReputation()</code>. They all
            enforced in the <code>beforeHandle</code> hook. So does{" "}
            <code>responseCache()</code>. When a cache hit returns a response
            from that hook, the hook chain ends.
          </p>
          <CodeBlock language="ts" code={CACHE_ORDER} />
          <p>
            A denied country got a 200 with the cached body. So did a
            deny-listed address, a blocked user agent, and a client that was
            actively banned. The only trace was an <code>x-cache: HIT</code>
            header that looks completely normal, because it is completely normal.
          </p>
          <p>
            The part I am not proud of: my own response-cache quick start mounts
            the cache first. Anybody following the docs built the vulnerable
            order. There was already a boot guard for a cache mounted ahead of{" "}
            <code>tenancy()</code>, so I had recognised this exact class of
            mistake before and fixed one instance of it without asking what else
            shared the shape.
          </p>

          <h2>Then the same shape ate the rate limiter</h2>
          <p>
            After moving those five gates to <code>preBody</code>, which always
            runs before <code>beforeHandle</code>, I went looking for other pairs
            with the same phase collision. <code>rateLimit()</code> also enforces
            in <code>beforeHandle</code>.
          </p>
          <CodeBlock language="ts" code={LIMITER_ORDER} />
          <p>
            A limiter behind a cache never counts the requests the cache serves.
            Same for <code>idempotency()</code>, which replays stored responses
            from the same hook. An operator writes <code>max: 2</code> and gets
            unlimited, on exactly the repeat traffic a rate limit exists to
            bound.
          </p>
          <p>
            I could not fix this the way I fixed the gates. Moving{" "}
            <code>rateLimit()</code> to <code>preBody</code> would break every
            caller-supplied <code>keyGenerator</code> that reads{" "}
            <code>ctx.state</code>, because <code>session()</code> and auth
            layers populate state later. I know that specifically because the
            phase move on the five gates broke their callbacks the same way and I
            had to add a typed context to catch it at compile time. So 1.0.0
            refuses the ordering at boot instead.
          </p>
          <CodeBlock language="ts" code={BOOT_GUARD} />

          <h2>The header bug that was my own bad habit</h2>
          <p>
            Separate finding, same flavour of blind spot. Every middleware that
            keys on client IP read the leftmost <code>X-Forwarded-For</code>{" "}
            entry, which is the one slot in that header an attacker fully
            controls.
          </p>
          <CodeBlock language="ts" code={XFF} />
          <p>
            I have written <code>split(&quot;,&quot;)[0]</code> against that
            header in production services for years without thinking about it.
            Nine copies of it existed in this codebase, which is the real lesson:
            the same wrong line in nine places is nine chances to be wrong and
            nine separate fixes. The hop-aware helper now lives in one module and
            every middleware calls it.
          </p>

          <h2>A fix I shipped and then took back out</h2>
          <p>
            One more, because it is the most useful thing I learned and it makes
            me look bad.
          </p>
          <p>
            Node answers <code>100 Continue</code> to anyone who sends{" "}
            <code>Expect: 100-continue</code>, including a request whose declared{" "}
            <code>Content-Length</code> is already over the body limit. So the
            server invites a body it is about to refuse. I added a check that
            rejected at header time by comparing <code>Content-Length</code>{" "}
            against <code>bodyLimitBytes</code>, wrote tests, watched them pass,
            shipped it.
          </p>
          <p>
            Then I tested a route with no request body schema. That limit is only
            enforced where a body gets parsed, so a route that never parses one
            never applies it. My check was refusing requests the framework would
            happily have served. And because only clients sending{" "}
            <code>Expect</code> took that path, the same request got a 413 from
            curl (which sends the header for large bodies) and a 200 from{" "}
            <code>fetch</code>. A transport hint was changing the answer.
          </p>
          <p>
            I reverted it. The version in 1.0.0 defers the interim{" "}
            <code>100</code> until the framework actually reaches for the body,
            so the trigger is the framework&apos;s own decision and both paths
            agree by construction rather than because I remembered to test both.
            My original tests passed the whole time, because I had only tested
            the case my fix was written for.
          </p>

          <h2>What I changed about how I test</h2>
          <p>
            I stopped hunting per-module and started enumerating pairs. For every
            middleware I wrote down which hook phase it acts in and whether it
            can return a response early. That gives a small grid, and the
            dangerous cells are obvious once it is on paper: anything that
            answers early sitting in the same phase as, or ahead of, anything
            that enforces.
          </p>
          <p>
            That grid found the rate limiter bug in about twenty minutes after
            spending two days finding nothing on the per-module axis. It also
            told me which cells were already safe, which was worth knowing:{" "}
            <code>idempotency()</code> ahead of <code>bearerAuth()</code> is fine
            because its default scope partitions on the{" "}
            <code>Authorization</code> header, and <code>etag()</code> only acts
            in <code>onSend</code>, so it cannot preempt a gate at all.
          </p>
          <p>
            If you maintain anything with pluggable middleware, that exercise is
            cheap and I would do it before your next release. Write down the
            phases. Look at the pairs. The bug is probably not in your regex.
          </p>

          <h2>Getting it</h2>
          <CodeBlock
            language="bash"
            code={`pnpm create daloy@latest my-api
# or add it to something existing
pnpm add @daloyjs/core`}
          />
          <p>
            Orders that used to fail silently now refuse to boot in production,
            so if you are upgrading from an early RC and your app stops starting,
            read the error. It names the route and the two middlewares and tells
            you which one to register first. That is the guard doing its job, and
            the fix is a line of reordering. The full list is on{" "}
            <Link href="/docs/security/boot-guards">boot guards</Link>, and every
            release candidate is written up in the{" "}
            <a
              href="https://github.com/daloyjs/daloy/blob/main/CHANGELOG.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              changelog
            </a>
            .
          </p>
          <p>
            One thing I owe and have not done: the advisory for the forwarded
            header issue is not filed yet. The bug is fixed and published with
            provenance since rc.7, so anybody on a current version is fine, but
            my own security policy says the disclosure process gets exercised
            before stable and it has not been. It is the one stabilisation
            criterion 1.0.0 shipped without, it is written down as open in the
            roadmap rather than checked off anyway, and it is the next thing I
            do.
          </p>
        </div>
      </article>
    </main>
  );
}
