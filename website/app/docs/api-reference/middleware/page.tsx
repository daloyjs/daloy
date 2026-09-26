import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { LayerStack } from "../../../../components/diagram";

import { AuthRole } from "@/components/auth-role";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "API reference: Middleware & helpers",
  description:
    "DaloyJS middleware reference: built-in hooks (rateLimit, secureHeaders, cors, csrf), composition primitives (every, some, except), typed dependencies, config validation, logging, and connection info.",
  path: "/docs/api-reference/middleware",
  keywords: [
    "DaloyJS middleware API",
    "DaloyJS composition primitives",
    "DaloyJS defineConfig reference",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>API reference: Middleware &amp; helpers</h1>
      <p>
        Built-in middleware, the <code>every</code>/<code>some</code>/
        <code>except</code> composition primitives, typed dependencies, config
        validation, structured logging, the startup banner, and connection-info
        helpers. Everything on this page is exported from the root{" "}
        <code>@daloyjs/core</code> barrel. See the{" "}
        <Link href="/docs/api-reference">API reference overview</Link> for the
        full module map.
      </p>

      <LayerStack
        title="A typical middleware stack"
        layers={[
          {
            title: "Platform hygiene",
            detail: "applied by secureDefaults",
            items: ["requestId()", "secureHeaders()"],
            tone: "muted",
          },
          {
            title: "Traffic shaping",
            items: ["rateLimit()", "loadShedding()", "compression()"],
          },
          {
            title: "Authentication & access",
            items: ["bearerAuth()", "jwk()", "requireScopes()", "csrf()"],
            tone: "accent",
          },
          {
            title: "Route handler",
            detail: "typed ctx, typed response",
            tone: "success",
          },
        ]}
        caption="Hooks compose top to bottom. every(), some(), and except() combine layers. defineDependency() injects per-request values into ctx.state."
      />

      <h2 id="built-in-middleware">Built-in middleware</h2>
      <AuthRole role="resource-server">
        <p>
          The authentication middleware on this page (<code>bearerAuth()</code>
          {", "}
          <code>jwk()</code>
          {", "}
          <code>requireScopes()</code>
          {", "}
          <code>basicAuth()</code>) all sit on the receiving end of a token.
          They read a credential that something else issued and decide whether
          this request continues. None of them issue credentials, and{" "}
          <code>basicAuth()</code> in particular is for machine-to-machine and
          internal endpoints, not for logging in end users.
        </p>
      </AuthRole>

      <CodeBlock
        code={`requestId(opts?: RequestIdOptions): Hooks
secureHeaders(opts?: SecureHeadersOptions): Hooks
cors(opts: CorsOptions): Hooks
rateLimit(opts: RateLimitOptions): Hooks
loginThrottle(opts?: LoginThrottleOptions): Hooks    // default key: TCP peer (IPv6 grouped by ipv6Subnet)
timing(headerName?: string): Hooks
compression(opts?: CompressionOptions): Hooks        // skips SSE, NDJSON/JSON Lines/json-seq, Cache-Control: no-transform
bearerAuth(opts: BearerAuthOptions): Hooks
basicAuth(opts: BasicAuthOptions): Hooks
markAuthHook(hooks: Hooks): Hooks
const AUTH_HOOK_MARKER: unique symbol  // stamped by built-ins and markAuthHook()
csrf(opts?: CsrfOptions): Hooks
fetchMetadata(opts?: FetchMetadataOptions): Hooks   // Sec-Fetch-Site/Mode/Dest enforcement
requireScopes(scopes: string | string[]
            | { all?: string[]; any?: string[] }): Hooks
ipRestriction(opts: IpRestrictionOptions): Hooks    // CIDR allow/deny
loadShedding(opts?: LoadSheddingOptions): Hooks
etag(opts?: ETagOptions): Hooks                      // 304 + Set-Cookie / Cache-Control skip
  // SSE, NDJSON, unknown-length, and over-maxBytes bodies are sent untagged

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (ctx: RateLimitContext) => string; // may run on an early auth rejection
  ipv6Subnet?: number;             // default: 64 (1-128); IPv6 prefix for the default IP key (since 1.3.7)
  store?: RateLimitStore;          // default in-memory; use redisRateLimitStore for clusters
  trustProxyHeaders?: boolean;     // rightmost XFF; spoofable if origin is reachable
  trustedHops?: number;            // multi-hop chain length (implies trust)
  trustedProxies?: readonly string[]; // CIDR allowlist of proxy peers (peer-verified trust)
  retryAfter?: boolean;
  groupId?: string;
}
// A limiter placed before preBody auth also counts requests that auth
// rejects by throwing, so failed credential guesses consume the budget.

interface ETagOptions {
  weak?: boolean;
  generator?: (body: Uint8Array) => string | Promise<string>;
  maxBytes?: number;               // default: 1_048_576 (1 MiB); larger Content-Length goes untagged (since 1.3.7)
}

interface BearerAuthOptions {
  validate: (token: string) => boolean | Promise<boolean>;  // static check; token only
  verify?: BearerAuthVerifyHook;    // (token, ctx) => boolean | void; per-request revalidation
  realm?: string;
}`}
      />

      <h2 id="composition-primitives">Composition primitives</h2>
      <CodeBlock
        code={`every(...layers: Hooks[]): Hooks      // run every lifecycle phase in order
some (...layers: Hooks[]): Hooks      // pass the first successful preBody/beforeHandle auth gate
except(when: ExceptPredicate, hooks: Hooks): Hooks  // exempt paths from preBody + beforeHandle gates

type ExceptPredicate =
  | string                            // path glob: "*" = one segment, "**" = any suffix
  | string[]                          // any-of globs
  | ((ctx) => boolean | Promise<boolean>);

// Globs match the canonical path the router dispatches on. The Node adapter
// resolves raw %2e%2e dot segments and folds \\ to / before routing, and the
// Node and Lambda adapters refuse (400) a Host containing \\ / ? # @ % or
// whitespace, so a crafted target cannot slip past an except() glob. Route
// params and wildcards never bind "." or "..".`}
      />

      <h2 id="dependencies-typed-di-chain">Dependencies (typed DI chain)</h2>
      <CodeBlock
        code={`defineDependency<TName, TValue, TStateKey>(opts: {
  name: TName;
  dependsOn?: readonly string[];      // refuses cycles at registration
  stateKey?: TStateKey;
  resolve: (ctx) => TValue | Promise<TValue>;
}): DependencyHooks   // per-request cached; runs once per dependency per request`}
      />

      <h2 id="configuration">Configuration</h2>
      <CodeBlock
        code={`defineConfig<S extends StandardSchemaV1>(opts: {
  schema: S;
  source?: ConfigSource;               // default: "env" (process.env)
  stderr?: { write(chunk: string): void } | false;
}): Promise<StandardSchemaV1.InferOutput<S>>;
  // Async. Validates once at startup; throws ConfigValidationError on missing/invalid values.

type ConfigSource =
  | "env"
  | { kind: "env";    env: Record<string, string | undefined> }
  | { kind: "file";   path: string; parse?: (text: string) => unknown }
  | { kind: "object"; data: Record<string, unknown> }
  | { kind: "custom"; resolve: () => Promise<Record<string, unknown>> };

class ConfigValidationError extends Error {
  readonly issues: ReadonlyArray<{ key: string; message: string }>;
}`}
      />

      <h2 id="logging">Logging</h2>
      <CodeBlock
        code={`type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

createLogger(opts?: ConsoleLoggerOptions): Logger;
const noopLogger: Logger;
const DEFAULT_REDACT_KEYS: ReadonlyArray<string>;  // password, token, secret, authorization, ...
sanitizeUrlForLog(url: string): string;             // redacts sensitive query values
sanitizeUrlQueryForLog(search: string): string;     // same rules for a bare query string (since 1.3.7)
// Redaction copies on write: it never mutates the objects you pass to a log call.

interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  write?: (line: string) => void;
  redact?: LoggerRedactionOptions;     // { keys?, replacer? }
}

interface Logger {
  trace(obj?, msg?): void;
  debug(obj?, msg?): void;
  info (obj?, msg?): void;
  warn (obj?, msg?): void;
  error(obj?, msg?): void;
  fatal(obj?, msg?): void;
  child(bindings: Record<string, unknown>): Logger;
}`}
      />

      <h2 id="startup-banner">Startup banner</h2>
      <CodeBlock
        code={`interface StartupBannerLink { label: string; url: string }
interface StartupBannerOptions {
  name?: string;        // default: "DaloyJS"
  version?: string;
  url: string;
  runtime?: string;     // e.g. "Node.js", "Bun"
  links?: StartupBannerLink[];
  color?: boolean;
  ascii?: boolean;
}

formatStartupBanner(opts: StartupBannerOptions): string;
printStartupBanner(opts: StartupBannerOptions): void;`}
      />

      <h2 id="connection-info-and-proxy-posture">
        Connection info &amp; proxy posture
      </h2>
      <CodeBlock
        code={`type BehindProxyConfig = "none" | "loopback" | { hops: number } | { cidrs: readonly string[] };
interface ConnInfo { remoteAddress?: string; remotePort?: number; tls?: boolean }

getConnInfo(req: Request): ConnInfo | undefined;
setConnInfo(req: Request, info: ConnInfo): void;   // adapter helper
assertBehindProxy(cfg: BehindProxyConfig | undefined): void;
resolveClientIp(ctx, cfg?: BehindProxyConfig): string | undefined;
readRemoteAddress(ctx): string | undefined;
readRemotePort(ctx): number | undefined;
pickForwardedForByHops(header: string, hops: number): string | undefined;

// Spoof-resistant client IP: reads \`hops\` entries from the RIGHT of
// X-Forwarded-For (the slots your own proxy chain wrote). Falls back to
// X-Real-IP only when hops === 1; past that a chain shorter than the
// declaration yields undefined rather than a caller-settable header.
resolveForwardedClientIp(req: Request, hops?: number): string | undefined;`}
      />

      <h2 id="subdomains-public-suffix-aware">
        Subdomains (Public-Suffix-aware)
      </h2>
      <CodeBlock
        code={`subdomains(hostname: string, opts?: SubdomainsOptions): SubdomainsResult;

interface SubdomainsOptions {
  baseDomain?: string;                 // pin the registrable base; skips the PSL entirely
  extraSuffixes?: readonly string[];   // extra shared-hosting suffixes
  production?: boolean;                // default: false; throws on a stale PSL snapshot
}

interface SubdomainsResult {
  baseDomain: string;                  // e.g. "example.co.uk"
  subdomain: string;                   // e.g. "api.tenant"; "" when none
  labels: readonly string[];           // e.g. ["api", "tenant"]
}

const PSL_SNAPSHOT_DATE: string;       // ISO date of the bundled PSL snapshot
const MAX_SNAPSHOT_AGE_DAYS: number;   // 90; refuses to use a stale snapshot
const PSL_PUBLIC_SUFFIXES: readonly string[];

// The staleness check applies only to the PSL path. A call with baseDomain
// never reads the snapshot, so baseDomain + production: true always works.`}
      />

      <p>
        Next up:{" "}
        <Link href={"/docs/api-reference/security" as Route}>
          security &amp; auth helpers
        </Link>
        {"."}
      </p>
    </>
  );
}
