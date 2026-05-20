import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Wave 5 auth-cohesive slice (0.22.0)",
  description:
    "Daloy 0.22.0 ships the auth-cohesive slice of the Wave 5 leftover items: jwk() asymmetric-only JWKS middleware, per-scheme verify() revalidation hook on bearerAuth() and jwk(), basicAuth({ onAuthSuccess }) typed callback, and Cache-Control: no-store on every first-party auth helper 401 challenge.",
  path: "/docs/security/wave-5-auth",
  keywords: [
    "DaloyJS jwk",
    "JWKS",
    "Bearer revalidation",
    "verify hook",
    "basicAuth onAuthSuccess",
    "Cache-Control no-store",
    "WWW-Authenticate",
    "RFC 6750",
    "asymmetric JWT",
    "kid",
    "alg cross-check",
    "0.22.0",
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Wave 5 auth-cohesive slice (0.22.0)</h1>
      <p>
        Daloy <strong>0.22.0</strong> closes the auth-cohesive subset of the
        Wave 5 leftover items from the secure-by-default initiative. Each one
        is additive and opt-in:
      </p>
      <ul>
        <li>
          <code>jwk()</code> — asymmetric-only Bearer-token middleware backed
          by a JWKS source. Refuses <code>HS*</code> at construction, requires
          a <code>kid</code> header that matches a JWK in the set, and
          cross-checks JWT-header <code>alg</code> against the JWK&apos;s
          declared <code>alg</code> when both are present.
        </li>
        <li>
          <code>bearerAuth({"{ verify }"})</code> / <code>jwk({"{ verify }"})</code>{" "}
          — per-request revalidation hook so revocation lists, token-version
          counters, and &quot;user changed password since this token was
          issued&quot; checks can invalidate previously-issued credentials.
        </li>
        <li>
          <code>basicAuth({"{ onAuthSuccess }"})</code> — typed-context
          callback that fires after <code>ctx.state.user.username</code> is
          stamped, so handlers do not re-parse the <code>Authorization</code>{" "}
          header.
        </li>
        <li>
          <code>Cache-Control: no-store</code> on every first-party auth
          helper <code>401</code> challenge (<code>bearerAuth()</code>,{" "}
          <code>basicAuth()</code>, <code>jwk()</code>) so intermediaries
          never cache an auth challenge — RFC 9111 §3.5 and Wave 9 audit item
          24 alignment.
        </li>
      </ul>

      <h2>
        1. <code>jwk()</code> middleware
      </h2>
      <p>
        Drop-in Bearer-token middleware backed by a JWKS source. The
        algorithm allowlist is intentionally narrow: only{" "}
        <code>RS256</code> / <code>RS384</code> / <code>RS512</code>,{" "}
        <code>PS256</code> / <code>PS384</code> / <code>PS512</code>,{" "}
        <code>ES256</code> / <code>ES384</code> / <code>ES512</code>, and{" "}
        <code>EdDSA</code>. Symmetric <code>HS*</code> algorithms are refused
        at construction — the classic confused-deputy &quot;HS256 verified
        with the JWKS public key as the HMAC secret&quot; attack cannot be
        configured. The middleware is exported from the dedicated subpath{" "}
        <code>@daloyjs/core/jwk</code>.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { jwk } from "@daloyjs/core/jwk";

const app = new App();

app.use(
  jwk({
    algorithms: ["RS256", "ES256"],
    jwks: "https://login.example.com/.well-known/jwks.json",
    issuer: "https://login.example.com/",
    audience: "https://api.example.com",
    fetchTtlSeconds: 600,
    realm: "api",
  }),
);
`}
        language="ts"
      />
      <p>
        <code>jwks</code> accepts a static <code>JwkSet</code>, an{" "}
        <code>https://</code> URL (with TTL caching and in-flight-promise
        dedup so a thundering-herd of concurrent requests resolves into a
        single fetch), or a custom resolver function. <code>http://</code>{" "}
        JWKS URLs and non-finite / negative <code>fetchTtlSeconds</code> are
        refused at construction. The middleware stamps{" "}
        <code>ctx.state.user = {"{ sub, scopes, claims }"}</code>; the scope
        normalizer reads <code>scope</code> (RFC 6749 space-separated string),{" "}
        <code>scp</code> (Azure AD array), and <code>scopes</code> (array)
        claims and dedupes the result.
      </p>

      <h2>
        2. Per-scheme <code>verify(credentials, ctx)</code> hook
      </h2>
      <p>
        Both <code>bearerAuth()</code> and <code>jwk()</code> accept an
        optional <code>verify</code> callback that runs after the static{" "}
        <code>validate</code> / signature check passes. Returning{" "}
        <code>false</code> throws <code>ForbiddenError</code> (
        <code>403</code>, no <code>WWW-Authenticate</code> per RFC 6750);
        returning <code>true</code> or <code>undefined</code> accepts. Use it
        to consult a revocation list, a token-version counter, or any other
        per-request signal that a previously-issued token has been
        invalidated.
      </p>
      <CodeBlock
        code={`import { bearerAuth } from "@daloyjs/core";

app.use(
  bearerAuth({
    validate: (token) => verifyOpaqueToken(token),
    verify: async (token, ctx) => {
      const tenantId = ctx.request.headers.get("x-tenant-id") ?? "default";
      return !(await isTokenRevoked(tenantId, token));
    },
  }),
);
`}
        language="ts"
      />

      <h2>
        3. <code>basicAuth({"{ onAuthSuccess }"})</code>
      </h2>
      <p>
        Fires once <code>ctx.state.user.username</code> has been stamped, with
        the typed <code>(credentials, ctx)</code> tuple. The previous
        idiomatic workaround was a separate <code>beforeHandle</code> that
        re-parsed the <code>Authorization</code> header in every handler;
        that is no longer necessary.
      </p>
      <CodeBlock
        code={`import { basicAuth } from "@daloyjs/core";

app.use(
  basicAuth({
    verify: (username, password) => verifyCredentials(username, password),
    onAuthSuccess: async ({ username }, ctx) => {
      ctx.state.authenticatedUser = username;
      await recordBasicAuthSuccess(username);
    },
  }),
);
`}
        language="ts"
      />

      <h2>
        4. <code>Cache-Control: no-store</code> on auth 401 challenges
      </h2>
      <p>
        Every first-party auth helper now emits{" "}
        <code>Cache-Control: no-store</code> alongside{" "}
        <code>WWW-Authenticate</code> on the <code>401</code> response. A
        shared CDN, a corporate proxy, or a service-worker cache could
        previously cache the challenge and serve it to a different user;
        <code>no-store</code> closes that fingerprinting and stale-challenge
        risk. This applies uniformly to <code>bearerAuth()</code>,{" "}
        <code>basicAuth()</code>, and the new <code>jwk()</code>.
      </p>

      <h2>What did not ship in 0.22.0</h2>
      <p>
        The remaining Wave 5 leftover items — <code>wsRateLimit()</code> /{" "}
        <code>graphqlRateLimit()</code> adapters, <code>loginThrottle()</code>{" "}
        preset, <code>rotateSession()</code> helper, the file-upload MIME +
        magic-byte + size guard, the <code>requirePayloadAuth</code> scheme
        flag, and the WebSocket-helper safe defaults — remain tracked in{" "}
        <a href="https://github.com/daloyjs/daloy/blob/main/ROADMAP.md">
          ROADMAP.md
        </a>{" "}
        and will land in subsequent additive releases.
      </p>
    </>
  );
}
