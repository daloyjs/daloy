import { CodeBlock } from "../../../../components/code-block";
import { FlowDiagram, SequenceDiagram } from "../../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "JWT and authentication safeguards",
  description:
    "Secure DaloyJS authentication with asymmetric JWKS middleware, per-scheme revalidation hooks, typed basic-auth callbacks, and non-cacheable authentication challenges.",
  path: "/docs/security/auth-slice",
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
    "secureDefaults",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>JWT and authentication safeguards</h1>
      <blockquote>
        <strong>Think of it like…</strong> a building lobby that does three
        things most don&apos;t. It checks not just your badge but who issued it
        (JWKS lookup by <code>kid</code>), revalidates that you still work here
        on every request (the <code>verify</code> hook), and refuses to cache
        the &quot;denied&quot; answer at the elevator, so a fired employee
        can&apos;t ride up tomorrow on a stale 401 (
        <code>Cache-Control: no-store</code>).
      </blockquote>

      <h2 id="daloyjs-is-a-relying-party-not-an-auth-server">
        DaloyJS is a Relying Party, not an auth server
      </h2>
      <p>
        DaloyJS validates tokens; it does not mint user sessions through an
        authorization-code flow, host a consent screen, or store user/client
        credentials. Pair these middleware with a dedicated identity provider:
      </p>
      <ul>
        <li>
          <strong>Hosted IdPs</strong>: Auth0, Okta, Azure AD / Entra ID, AWS
          Cognito, Google Identity, Clerk, WorkOS, Supabase Auth, Logto, Stytch,
          Kinde. Anything that publishes a standard{" "}
          <code>/.well-known/jwks.json</code> works with <code>jwk()</code> out
          of the box.
        </li>
        <li>
          <strong>Self-hosted IdPs</strong>: Keycloak, Ory Hydra, ZITADEL,
          Authentik, Dex. Same JWKS contract, same one-line <code>jwk()</code>{" "}
          setup.
        </li>
        <li>
          <strong>Your own sibling auth service</strong>: a separate DaloyJS app
          using <code>createJwtSigner()</code> to mint tokens and exposing a
          JWKS endpoint. The API service then validates those tokens with{" "}
          <code>jwk()</code> exactly as it would for an external IdP.
        </li>
      </ul>
      <p>Rough mapping of which middleware to reach for:</p>
      <ul>
        <li>
          <strong>Browser app + external IdP (OIDC)</strong>: <code>jwk()</code>{" "}
          on the API, <code>requireScopes()</code> per route,{" "}
          <code>session()</code> only if you also need server-side session state
          alongside the access token.
        </li>
        <li>
          <strong>Service-to-service inside one tenant</strong>:{" "}
          <code>bearerAuth({"{ validate }"})</code> with an opaque token, or{" "}
          <code>jwk()</code> if both sides already speak JWT. The{" "}
          <a href="/docs/security/internal-service-preset">
            internal-service preset
          </a>{" "}
          relaxes browser-only headers for these endpoints.
        </li>
        <li>
          <strong>Webhook receivers</strong>: neither <code>bearerAuth()</code>{" "}
          nor <code>jwk()</code>; use the dedicated HMAC verifier (see the{" "}
          <a href="/docs/security">security overview</a>).
        </li>
        <li>
          <strong>Admin tools / scripts</strong>: <code>basicAuth()</code>{" "}
          behind <code>ipRestriction()</code>, or short-lived JWTs from your
          IdP.
        </li>
      </ul>
      <p>
        Daloy provides a cohesive set of authentication safeguards. Each one is
        additive and opt-in:
      </p>
      <ul>
        <li>
          <code>jwk()</code>: asymmetric-only Bearer-token middleware backed by
          a JWKS source. Refuses <code>HS*</code> at construction, requires a{" "}
          <code>kid</code> header that matches a JWK in the set, and
          cross-checks JWT-header <code>alg</code> against the JWK&apos;s
          declared <code>alg</code> when both are present.
        </li>
        <li>
          <code>bearerAuth({"{ verify }"})</code> /{" "}
          <code>jwk({"{ verify }"})</code>: per-request revalidation hook so
          revocation lists, token-version counters, and &quot;user changed
          password since this token was issued&quot; checks can invalidate
          previously-issued credentials.
        </li>
        <li>
          <code>basicAuth({"{ onAuthSuccess }"})</code>: typed-context callback
          that fires after <code>ctx.state.user.username</code> is stamped, so
          handlers do not re-parse the <code>Authorization</code> header.
        </li>
        <li>
          <code>Cache-Control: no-store</code> on every first-party auth helper{" "}
          <code>401</code> challenge (<code>bearerAuth()</code>,{" "}
          <code>basicAuth()</code>, <code>jwk()</code>) so intermediaries never
          cache an auth challenge, RFC 9111 §3.5 and audit alignment.
        </li>
      </ul>

      <h2 id="1-jwk-middleware">
        1. <code>jwk()</code> middleware
      </h2>
      <p>
        Drop-in Bearer-token middleware backed by a JWKS source. The algorithm
        allowlist is intentionally narrow: only <code>RS256</code> /{" "}
        <code>RS384</code> / <code>RS512</code>, <code>PS256</code> /{" "}
        <code>PS384</code> / <code>PS512</code>, <code>ES256</code> /{" "}
        <code>ES384</code> / <code>ES512</code>, and <code>EdDSA</code>.
        Symmetric <code>HS*</code> algorithms are refused at construction, the
        classic confused-deputy &quot;HS256 verified with the JWKS public key as
        the HMAC secret&quot; attack cannot be configured. The middleware is
        exported from the dedicated subpath <code>@daloyjs/core/jwk</code>.
      </p>

      <SequenceDiagram
        title="Verifying a Bearer token with jwk()"
        participants={["Client", "jwk() middleware", "IdP JWKS"]}
        steps={[
          {
            from: "Client",
            to: "jwk() middleware",
            label: "Request with Bearer token",
            detail: "JWT header carries kid + alg",
            kind: "request",
          },
          {
            from: "jwk() middleware",
            to: "IdP JWKS",
            label: "Fetch key set by kid",
            detail: "TTL-cached, in-flight dedup, stale fallback",
            kind: "async",
          },
          {
            from: "jwk() middleware",
            to: "jwk() middleware",
            label: "Cross-check JWT alg vs JWK alg; reject HS*",
            detail: "asymmetric-only allowlist",
            kind: "note",
          },
          {
            from: "jwk() middleware",
            to: "Client",
            label: "Verify signature + exp, stamp ctx.state.user",
            detail: "{ sub, scopes, claims }",
            kind: "response",
          },
        ]}
        caption="jwk() resolves the signing key by kid from the JWKS source, cross-checks the JWT-header alg against the JWK, and refuses HS* so the confused-deputy attack cannot be configured. Tokens are always cryptographically verified and exp-checked."
      />

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
    maxStaleSeconds: 3600,
    realm: "api",
  }),
);
`}
        language="ts"
      />
      <p>
        <code>jwks</code> accepts a static <code>JwkSet</code>, an{" "}
        <code>https://</code> URL (with TTL caching and in-flight-promise dedup
        so a thundering-herd of concurrent requests resolves into a single
        fetch), or a custom resolver function. <code>http://</code> JWKS URLs
        and non-finite / negative <code>fetchTtlSeconds</code> /{" "}
        <code>maxStaleSeconds</code> are refused at construction. The middleware
        stamps <code>ctx.state.user = {"{ sub, scopes, claims }"}</code>; the
        scope normalizer reads <code>scope</code> (RFC 6749 space-separated
        string), <code>scp</code> (Azure AD array), and <code>scopes</code>{" "}
        (array) claims and dedupes the result.
      </p>
      <p>
        When the JWKS source is a URL, a TTL-expiry refresh that fails (network
        error, non-2xx, or malformed body) does not take down every request: the
        last successfully fetched key set keeps serving for a bounded{" "}
        <code>maxStaleSeconds</code> grace window (default <code>3600</code>,
        set <code>0</code> to disable) on top of <code>fetchTtlSeconds</code>.
        The very first fetch is never eligible for this fallback, so an
        unreachable IdP at boot still fails closed, and tokens are always
        cryptographically verified and <code>exp</code>-checked regardless.
      </p>

      <h2 id="2-per-scheme-verify-credentials-ctx-hook">
        2. Per-scheme <code>verify(credentials, ctx)</code> hook
      </h2>
      <p>
        Both <code>bearerAuth()</code> and <code>jwk()</code> accept an optional{" "}
        <code>verify</code> callback that runs after the static{" "}
        <code>validate</code> / signature check passes. Returning{" "}
        <code>false</code> throws <code>ForbiddenError</code> (<code>403</code>,
        no <code>WWW-Authenticate</code> per RFC 6750); returning{" "}
        <code>true</code> or <code>undefined</code> accepts. Use it to consult a
        revocation list, a token-version counter, or any other per-request
        signal that a previously-issued token has been invalidated. These
        callbacks run in <code>preBody</code>: raw route/header context is
        available, but <code>ctx.body</code> is always <code>undefined</code> so
        an unauthenticated upload can be rejected before it is consumed.
      </p>

      <FlowDiagram
        title="Static check then per-request revalidation"
        numbered
        steps={[
          {
            eyebrow: "static",
            label: "validate / signature check",
            detail: "token shape or JWT signature + exp",
          },
          {
            eyebrow: "revalidate",
            label: "verify(credentials, ctx)",
            detail: "revocation list, token-version, password-changed",
            tone: "accent",
          },
          {
            eyebrow: "returns false",
            label: "ForbiddenError",
            detail: "403, no WWW-Authenticate (RFC 6750)",
            tone: "danger",
          },
          {
            eyebrow: "true / undefined",
            label: "Request accepted",
            detail: "handler runs",
            tone: "success",
          },
        ]}
        caption="The verify hook runs only after the static validate or signature check passes, so a structurally valid but revoked token is still rejected with 403. Returning true or undefined accepts the request."
      />

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

      <h2 id="3-basicauth">
        3. <code>basicAuth({"{ onAuthSuccess }"})</code>
      </h2>
      <p>
        Fires once <code>ctx.state.user.username</code> has been stamped, with
        the typed <code>(credentials, ctx)</code> tuple. The previous idiomatic
        workaround was a separate <code>beforeHandle</code> that re-parsed the{" "}
        <code>Authorization</code> header in every handler; that is no longer
        necessary. The callback runs in <code>preBody</code>, so move any logic
        that requires a validated request body into a later{" "}
        <code>beforeHandle</code>.
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

      <h2 id="4-cache-control-no-store-on-auth-401-challenges">
        4. <code>Cache-Control: no-store</code> on auth 401 challenges
      </h2>
      <p>
        Every first-party auth helper now emits{" "}
        <code>Cache-Control: no-store</code> alongside{" "}
        <code>WWW-Authenticate</code> on the <code>401</code> response. A shared
        CDN, a corporate proxy, or a service-worker cache could previously cache
        the challenge and serve it to a different user;
        <code>no-store</code> closes that fingerprinting and stale-challenge
        risk. This applies uniformly to <code>bearerAuth()</code>,{" "}
        <code>basicAuth()</code>, and the new <code>jwk()</code>.
      </p>

      <h2 id="related-auth-safeguards">Related auth safeguards</h2>
      <p>
        Related protections include the <code>wsRateLimit()</code> adapter,{" "}
        <code>loginThrottle()</code> preset, <code>rotateSession()</code>{" "}
        helper, the file-upload MIME + magic-byte + size guard, the{" "}
        <code>requirePayloadAuth</code> scheme flag, and the WebSocket-helper
        safe defaults, are covered in{" "}
        <a href="/docs/security/websocket-login-throttle">
          WebSocket and login safeguards
        </a>
        .
      </p>
    </>
  );
}
