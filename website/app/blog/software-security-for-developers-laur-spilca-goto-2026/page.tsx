import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { buildMetadata, serializeJsonLd, SITE_URL } from "@/lib/seo";

const POST = {
  slug: "software-security-for-developers-laur-spilca-goto-2026",
  title:
    "Watch: Laur Spilca on Software Security for Developers (GOTO 2026), and What DaloyJS Already Decides for You",
  description:
    "Laurentiu Spilca and Thomas Vitale spend a GOTO 2026 conversation on why developers avoid security, the eternal encoding-vs-hashing-vs-encryption confusion, the danger of reinventing crypto, AI writing code with no security awareness, and why PKI still matters. Here is the talk, plus an honest mapping of which of those problems a DaloyJS app already takes out of your hands.",
  date: "2026-06-17",
  readingTime: "9 min read",
  author: "Devlin Duldulao",
  authorRole: "Fullstack cloud engineer",
};

export const metadata = buildMetadata({
  title: POST.title,
  description: POST.description,
  path: `/blog/${POST.slug}`,
  keywords: [
    "software security for developers",
    "Laurentiu Spilca",
    "Laur Spilca",
    "Thomas Vitale",
    "GOTO 2026",
    "encoding vs hashing vs encryption",
    "PKI certificates",
    "AI generated code security",
    "do not reinvent crypto",
    "DaloyJS secure by default",
  ],
  type: "article",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const ENCODE_HASH_ENCRYPT = `// The confusion the talk keeps coming back to, in three lines.
//
// ENCODING: reversible, NO key. It is a costume, not a lock.
//   Anyone can take the costume off. Base64 is not "encrypted."
const encoded = Buffer.from("hunter2").toString("base64"); // aHVudGVyMg==
const back = Buffer.from(encoded, "base64").toString();    // "hunter2"  <- trivially reversed

// HASHING: one-way, no key, you cannot get the input back.
//   For PASSWORDS use a slow, salted KDF, never a bare SHA-256.
import { hash, verify } from "@daloyjs/core/password"; // argon2id under the hood
const stored = await hash("hunter2");          // $argon2id$v=19$m=...,t=...,p=...
const ok = await verify("hunter2", stored);    // true, constant-time compare

// ENCRYPTION: reversible, WITH a key. This is the actual lock.
import { seal, open } from "@daloyjs/core/crypto"; // AEAD (XChaCha20-Poly1305)
const box = await seal(secretKey, "card: 4111 1111 1111 1111");
const plain = await open(secretKey, box);`;

const DONT_ROLL_YOUR_OWN = `// "Don't reinvent established security standards." - the whole panel,
// repeatedly. DaloyJS does not give you a homemade token format, a custom
// MAC, or a "fast" password hash. It gives you the boring standard ones
// and makes the dangerous custom path the hard one to type.
import { App, jwt, session, csrf, secureHeaders } from "@daloyjs/core";

const app = new App();

// JWT verification uses a vetted library + JWKS rotation, not a
// hand-parsed "split on dots and base64-decode" routine that forgets
// to check the signature (the classic alg:none footgun).
app.use(jwt({ jwksUri: process.env.JWKS_URI! }));

// Sessions are signed + (optionally) encrypted cookies with the
// __Host- prefix, Secure, HttpOnly, SameSite=Lax already set.
app.use(session({ secret: process.env.SESSION_SECRET! }));

// CSRF is double-submit + Fetch-Metadata, not a token scheme you invented
// at 2am. See /blog/csrf-in-2026-double-submit-and-fetch-metadata.
app.use(csrf());

app.use(secureHeaders());`;

const SECRET_COMPARE = `# The "developers avoid security because it feels like a tax" problem,
# answered with CI gates instead of good intentions. Every create-daloy
# project runs these on every PR. A failure blocks merge.
pnpm verify:secret-comparisons   # all secret compares use timingSafeEqual, not ===
pnpm verify:no-leaked-credentials
pnpm verify:no-remote-exec       # no curl|sh, no eval(fetch(...))
pnpm verify:no-lifecycle-scripts
pnpm verify:actions-pinned       # every GH Action pinned to a commit SHA

# The point: you don't have to FEEL motivated about security at 5pm on a
# Friday. The pipeline is motivated for you.`;

const PKI_TLS = `// "Understanding PKI and certificates is more important than ever."
// DaloyJS does not invent its own transport. It runs behind real TLS and
// gives you the request-side primitives that assume a PKI exists:
//
//  - fetchGuard() does egress allow-listing AND validates the upstream
//    certificate chain (no "rejectUnauthorized: false" escape hatch in
//    the public API).
//  - mTLS client-cert auth is a first-party middleware, not a snowflake.
import { App, fetchGuard, clientCert } from "@daloyjs/core";

const app = new App();

// Mutual TLS: trust a CA, map the cert subject to a principal. The chain
// is verified by the platform's PKI, you don't parse ASN.1 by hand.
app.use(
  clientCert({
    ca: process.env.CLIENT_CA_PEM!,
    toPrincipal: (cert) => ({ sub: cert.subject.CN }),
  }),
);

app.use(fetchGuard({ allow: ["https://api.stripe.com"] }));`;

const AI_SLOP = `// "AI-generated code written without security awareness." This is the
// one I lose sleep over, because the model is confident and the reviewer
// is tired. DaloyJS assumes the handler was written by something that
// does not care, and puts the guardrails on the constructor:
new App();
//
//  - 1 MiB body cap + Content-Length check -> 413 (the model forgot limits)
//  - 30s request timeout (the model wrote a hung handler)
//  - __proto__ / constructor / prototype stripped from JSON (mass assignment)
//  - path traversal ('..' , '//', %2e%2e, %00) rejected before routing
//  - 5xx bodies redacted in production (no stack traces to the attacker)
//  - real 405 with Allow, not an enumeration-friendly 404
//  - cookies default __Host- + Secure + HttpOnly + SameSite=Lax
//
// And the schema IS the route, so the AI literally cannot ship an
// unvalidated body without a build-time error.`;

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
            <Badge variant="outline">Worth watching</Badge>
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
          <figure className="not-prose my-8">
            <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
              <iframe
                className="h-full w-full"
                src="https://www.youtube-nocookie.com/embed/eOeelv5CjXg"
                title="Software Security for Developers • Laur Spilca & Thomas Vitale • GOTO 2026"
                loading="lazy"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
            <figcaption className="mt-3 text-sm text-muted-foreground">
              <a
                href="https://www.youtube.com/watch?v=eOeelv5CjXg"
                target="_blank"
                rel="noopener noreferrer"
              >
                Software Security for Developers
              </a>{" "}
              · Laur Spilca &amp; Thomas Vitale · GOTO 2026. About 45 minutes,
              worth every one of them.
            </figcaption>
          </figure>

          <p>
            I have a rule: when a Java Champion who wrote a whole book on the
            subject sits down to explain why developers keep getting security
            wrong, I shut up and watch. Thomas Vitale interviews{" "}
            <strong>Laurentiu Spilca</strong> about his co-authored book{" "}
            <em>Software Security for Developers</em>
            {", "}and even though it is a Java-flavored conversation, almost
            none of it is actually about Java. It is about the things we all
            keep messing up, regardless of language.
          </p>

          <p>
            I have been writing backends for about ten years, the last few of
            them from a desk in Norway where the winters give you a lot of time
            to think about your past mistakes. Most of mine were security
            mistakes. So instead of a summary, here is the talk mapped against
            the thing I now build to stop myself from repeating those mistakes:{" "}
            <Link href="/">DaloyJS</Link>
            {". "}Where the framework already makes the decision for you, I
            will say so. Where it cannot, I will say that too.
          </p>

          <h2>1. Why developers avoid security</h2>

          <p>
            The panel is blunt about it: security feels like a tax. It is the
            part of the ticket with no demo, no dopamine, and a high chance of
            making you look slow. So it gets deferred to a sprint that never
            comes. I have done this. I have shipped the &quot;we will add auth
            properly later&quot; version and watched &quot;later&quot; turn into
            &quot;never&quot; until a pentest report turned it into
            &quot;urgently.&quot;
          </p>

          <p>
            My honest take is that you cannot motivate your way out of this. You
            have to make the secure path the lazy path. That is the entire
            design bet of DaloyJS. The dangerous defaults are off, and turning
            them back on is what costs you effort, not the other way around. And
            the parts that genuinely require discipline get moved into CI, so
            the pipeline stays motivated even when you do not.
          </p>

          <CodeBlock language="bash" code={SECRET_COMPARE} />

          <h2>2. Encoding, hashing, encryption: pick the right word</h2>

          <p>
            This is the part of the talk I wish I could mail to my younger self.
            The confusion between encoding, hashing, and encryption is not
            pedantry, it is the root cause of an enormous number of real bugs.
            Base64 is not encryption. SHA-256 of a password with no salt is not
            password storage. &quot;We encrypt the passwords&quot; is, nine
            times out of ten, a sentence that means &quot;we hashed them, badly,
            and we are not sure which.&quot;
          </p>

          <p>Three lines, three different jobs, never interchangeable:</p>

          <CodeBlock language="ts" code={ENCODE_HASH_ENCRYPT} />

          <p>
            DaloyJS does not try to teach you the difference in a tooltip. It
            just refuses to hand you the wrong tool with a friendly name.
            Passwords go through a salted argon2id KDF. Secrets at rest go
            through AEAD with a key. There is no <code>encrypt()</code> helper
            that just base64-encodes and lets you tell your boss it is secure.
            The vocabulary is enforced by the API surface.
          </p>

          <h2>3. Do not reinvent established security standards</h2>

          <p>
            Spilca hammers this and he is right. Every time a developer writes
            their own token format, their own MAC, their own &quot;fast&quot;
            password hash, they are signing up to lose a fight that brilliant
            cryptographers spent decades winning. The famous JWT{" "}
            <code>alg: none</code> disaster exists because people hand-parsed
            tokens and forgot the one step that mattered: checking the
            signature.
          </p>

          <p>
            So DaloyJS ships the boring standard versions and makes the custom
            path the awkward one. JWT verification goes through a vetted library
            with JWKS rotation. CSRF is double-submit plus Fetch-Metadata, which
            I wrote about in{" "}
            <Link href="/blog/csrf-in-2026-double-submit-and-fetch-metadata">
              CSRF in 2026</Link>
            {", "}not a scheme I invented. Sessions are signed cookies with the
            right prefixes already on.
          </p>

          <CodeBlock language="ts" code={DONT_ROLL_YOUR_OWN} />

          <h2>4. AI-generated code with no security awareness</h2>

          <p>
            This is the newest thread in the conversation and the one that
            actually keeps me up. The model is confident, fast, and completely
            unbothered by threat modeling. It will happily write a handler that
            reads any URL the prompt suggests, parses an unbounded body, and
            reflects an error straight back with the database hostname in it.
            And the reviewer, a real human, is tired at 5pm and the diff is 400
            lines long.
          </p>

          <p>
            You cannot out-discipline this with code review alone. The only
            thing that scales is assuming the handler was written by something
            that does not care, and putting the guardrails somewhere the model
            cannot skip: the constructor and the router.
          </p>

          <CodeBlock language="ts" code={AI_SLOP} />

          <p>
            Because the schema <em>is</em> the route in DaloyJS, an AI cannot
            ship an unvalidated body without producing a build-time error. That
            is the difference between &quot;please remember to validate&quot;
            and &quot;the build is red until you do.&quot; I unpacked more of
            this in{" "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe Coding Security</Link>
            {"."}
          </p>

          <h2>5. PKI and certificates still matter</h2>

          <p>
            The closing theme is one a lot of web developers secretly hope is
            someone else&apos;s job: PKI, certificate chains, who-signed-what.
            In a world of service meshes, mTLS between services, and signed
            artifacts in your supply chain, &quot;I just trust whatever the load
            balancer terminates&quot; is not a strategy anymore.
          </p>

          <p>
            DaloyJS does not invent its own transport, that would violate rule
            3. It assumes a real PKI exists and gives you the request-side
            primitives that lean on it: client-certificate auth as first-party
            middleware, and a <code>fetchGuard()</code> that validates the
            upstream chain with no <code>rejectUnauthorized: false</code> escape
            hatch in the public API.
          </p>

          <CodeBlock language="ts" code={PKI_TLS} />

          <h2>What the talk owns that no framework can</h2>

          <ul>
            <li>
              Understanding <em>why</em> a standard works. A framework can pick
              argon2id for you. It cannot make you understand what a salt is
              for, and the day you need to debug something, that understanding
              is the whole game. Watch the talk for that part.
            </li>
            <li>
              Threat modeling your specific domain. No default knows that{" "}
              <em>your</em> admin route leaks tenant data across customers. That
              is human work.
            </li>
            <li>
              Caring. The framework removes the easy excuses, but it cannot make
              you read the CVE. Spilca&apos;s whole pitch is that security is a
              literacy, not a library, and he is correct.
            </li>
          </ul>

          <h2>The takeaway</h2>

          <p>
            Watch the talk for the literacy: the <em>why</em> behind encoding
            versus hashing versus encryption, why reinventing crypto is a losing
            bet, and why PKI is back on your plate whether you like it or not.
            Then let a secure-by-default framework carry the parts that are pure
            muscle memory, so the only security decisions left on your desk are
            the ones that actually need a human.
          </p>

          <p>
            That is the split I have landed on after ten years of learning these
            lessons the expensive way. The book and the talk make you literate.
            The framework keeps you from typing the obvious mistake at 1am. You
            want both.
          </p>

          <p className="text-sm text-muted-foreground">
            Related reading on this blog:{" "}
            <Link href="/blog/vibe-coding-security-what-daloyjs-already-blocks">
              Vibe Coding Security</Link>
            {", "}
            <Link href="/blog/csrf-in-2026-double-submit-and-fetch-metadata">
              CSRF in 2026</Link>
            {", "}
            <Link href="/blog/csp-nonces-and-trusted-types-without-tears">
              CSP Nonces and Trusted Types</Link>
            {", "}<Link href="/blog/secure-by-default">Secure by Default</Link>
            {"."}
          </p>
        </div>
      </article>
    </main>
  );
}
