import { CodeBlock } from "../../../../components/code-block";
import { BranchDiagram, FlowDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Password hashing (passwordHash)",
  description:
    "Hash and verify passwords with zero configuration: passwordHash() and passwordVerify() use OWASP-aligned scrypt from Node core, a PHC-style output string, and constant-time verification, with no runtime dependencies.",
  path: "/docs/security/hashing",
  keywords: [
    "DaloyJS password hashing",
    "passwordHash",
    "passwordVerify",
    "scrypt",
    "OWASP password storage",
    "PHC string format",
    "argon2 alternative",
    "bcrypt alternative",
    "timing safe comparison",
    "credential storage Node.js",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Password hashing</h1>
      <blockquote>
        The password helpers use one versioned scrypt format with fixed security
        checks. Applications store the encoded hash and verify candidates
        without handling the low-level parameters themselves.
      </blockquote>
      <p>
        Daloy ships exactly one correct way to hash a password. The API is two
        functions with <strong>no knobs</strong>
        {": "}no algorithm switch, no cost-factor argument, no salt management.
        Import them from the <code>@daloyjs/core/hashing</code> subpath:
      </p>
      <CodeBlock
        code={`import { passwordHash, passwordVerify } from "@daloyjs/core/hashing";

const hash = await passwordHash("hunter2");
// "$scrypt$N=131072,r=8,p=1$<salt-base64>$<hash-base64>"

await passwordVerify("hunter2", hash); // true
await passwordVerify("wrong", hash);   // false`}
        language="ts"
      />

      <FlowDiagram
        title="One password in, one PHC string out"
        numbered
        steps={[
          {
            eyebrow: "input",
            label: "Plaintext password",
            detail: "UTF-8, 1 to 4096 bytes",
          },
          {
            eyebrow: "salt",
            label: "Random 16-byte salt",
            detail: "crypto.randomBytes per call",
          },
          {
            eyebrow: "kdf",
            label: "scrypt (Node core)",
            detail: "N=2^17, r=8, p=1, 32-byte key",
            tone: "accent",
          },
          {
            eyebrow: "output",
            label: "PHC-style string",
            detail: "$scrypt$N=131072,r=8,p=1$...$...",
            tone: "success",
          },
        ]}
        caption="passwordHash() encodes the algorithm, parameters, salt, and digest into one self-describing string, so verifying later never requires re-supplying any of them."
      />

      <h2 id="why-scrypt">Why scrypt, not Argon2 or bcrypt</h2>
      <p>
        OWASP&apos;s Password Storage Cheat Sheet lists Argon2id first and
        scrypt as the recommended alternative. Argon2id has no implementation in
        Node core: using it means installing a native binding, and{" "}
        <code>@daloyjs/core</code> refuses to ship runtime dependencies as a
        supply-chain guarantee. scrypt is memory-hard like Argon2, ships in{" "}
        <code>node:crypto</code>
        {", "}and Daloy pins it to the OWASP-aligned parameters (
        <code>N = 2^17</code>
        {", "}
        <code>r = 8</code>
        {", "}
        <code>p = 1</code>
        {", "}32-byte key, 16-byte salt). bcrypt is not memory-hard and silently
        truncates passwords at 72 bytes, so it is not offered at all.
      </p>
      <p>
        If your organization mandates Argon2id specifically, install the{" "}
        <code>argon2</code> package in your app and use it directly: the
        framework intentionally does not wrap it.
      </p>

      <h2 id="verification">Constant-time verification, no exception oracle</h2>
      <p>
        <code>passwordVerify()</code> re-derives the key with the parameters
        stored in the PHC string and compares digests with{" "}
        <code>crypto.timingSafeEqual</code>
        {". "}It returns <code>false</code> for <em>any</em> failure, including
        a malformed or truncated stored hash, and never throws. A caller (or an
        attacker watching your error responses) cannot distinguish &quot;corrupt
        hash in the database&quot; from &quot;wrong password&quot; through
        exception side channels.
      </p>

      <BranchDiagram
        title="passwordVerify(password, storedHash)"
        source={{
          eyebrow: "login attempt",
          label: "Re-derive scrypt key",
          detail: "params + salt parsed from the stored PHC string",
        }}
        branches={[
          {
            eyebrow: "digests equal",
            label: "true",
            detail: "timingSafeEqual comparison",
            tone: "success",
          },
          {
            eyebrow: "anything else",
            label: "false, never throws",
            detail: "wrong password, malformed hash, foreign parameters",
            tone: "danger",
          },
        ]}
        caption="Every failure path collapses into the same boolean so response timing and error shape leak nothing about why verification failed."
      />

      <h2 id="phc-format">The PHC string</h2>
      <p>
        The output is a{" "}
        <a
          href="https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md"
          target="_blank"
          rel="noreferrer"
        >
          PHC-style
        </a>{" "}
        string that is safe to store in a single database column:
      </p>
      <CodeBlock
        code={`$scrypt$N=131072,r=8,p=1$5uPXKW3ZJdyj0hrSNz7BSg$1kSpZzz9mcXpAsRq/ZmTHktGlaFsD16kSCPWDT9CJ7c
   |         |                 |                    |
   |         |                 |                    +-- 32-byte derived key (base64)
   |         |                 +-- 16-byte random salt (base64)
   |         +-- cost parameters, pinned to OWASP-aligned values
   +-- algorithm identifier`}
        language="text"
      />
      <p>
        Verification accepts only this exact shape. Hashes that claim different{" "}
        <code>N</code>/<code>r</code>/<code>p</code> values are rejected rather
        than honored, so an attacker who can tamper with stored hashes cannot
        downgrade a record to a cheap cost factor and brute-force it offline.
      </p>

      <h2 id="guardrails">Input guardrails</h2>
      <ul>
        <li>
          Empty passwords are rejected: <code>passwordHash</code> throws a{" "}
          <code>TypeError</code> and <code>passwordVerify</code> returns{" "}
          <code>false</code>.
        </li>
        <li>
          4096-byte cap
          {": "}scrypt runs PBKDF2-HMAC-SHA256 over the full password, so an
          unbounded input lets an attacker amplify CPU per call. Anything longer
          than 4096 UTF-8 bytes is refused, which is far above any legitimate
          passphrase.
        </li>
        <li>
          Fresh salt per hash
          {": "}hashing the same password twice yields two different strings, so
          equal passwords are not linkable across rows.
        </li>
      </ul>

      <h2 id="login-slice">In a login slice</h2>
      <CodeBlock
        code={`import { z } from "zod";
import { App, loginThrottle } from "@daloyjs/core";
import { passwordHash, passwordVerify } from "@daloyjs/core/hashing";

const app = new App();
const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(1024),
});

app.post(
  "/signup",
  {
    request: { body: credentials },
    responses: { 201: { description: "Created" } },
  },
  async ({ body }) => {
    await db.users.insert({
      email: body.email,
      passwordHash: await passwordHash(body.password),
    });
    return { status: 201 };
  },
);

app.post(
  "/login",
  {
    hooks: loginThrottle({ windowMs: 60_000, max: 5 }),
    request: { body: credentials },
    responses: {
      200: { description: "OK" },
      401: { description: "Invalid credentials" },
    },
  },
  async ({ body }) => {
    const user = await db.users.findByEmail(body.email);
    // Verify against a dummy hash when the user is missing so response
    // timing does not reveal which emails exist.
    const ok = await passwordVerify(
      body.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !ok) return { status: 401 };
    return { status: 200 };
  },
);`}
        language="ts"
      />
      <p>
        Pair it with <code>loginThrottle()</code> (see the{" "}
        <a href="/docs/security/websocket-login-throttle">login throttle</a>{" "}
        page) so online guessing is rate-limited, and with the{" "}
        <a href="/docs/security/auth-slice">auth slice</a> for the full
        session/CSRF picture. The <code>DUMMY_HASH</code> pattern above keeps
        the scrypt work constant whether or not the account exists; generate it
        once at boot with <code>await passwordHash(randomUUID())</code>.
      </p>

      <h2 id="when-not">When not to use it</h2>
      <p>
        <code>passwordHash</code> is for credentials a human types. For API keys
        and webhook secrets that are long and random, a plain{" "}
        <code>SHA-256</code> digest compared with <code>timingSafeEqual()</code>{" "}
        is appropriate and thousands of times cheaper: memory-hard KDFs only
        exist to slow down guessing of low-entropy secrets. For signing, see{" "}
        <a href="/docs/http-signatures">HTTP message signatures</a>.
      </p>
    </>
  );
}
