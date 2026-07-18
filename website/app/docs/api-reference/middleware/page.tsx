import type { Route } from "next";
import Link from "next/link";

import { CodeBlock } from "../../../../components/code-block";
import { LayerStack } from "../../../../components/diagram";

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
        caption="Hooks compose top to bottom. every(), some(), and except() combine layers; defineDependency() injects per-request values into ctx.state."
      />

      <h2 id="built-in-middleware">Built-in middleware</h2>
      <CodeBlock
        code={`requestId(opts?: RequestIdOptions): Hooks
secureHeaders(opts?: SecureHeadersOptions): Hooks
cors(opts: CorsOptions): Hooks
rateLimit(opts: RateLimitOptions): Hooks
loginThrottle(opts?: LoginThrottleOptions): Hooks
timing(headerName?: string): Hooks
compression(opts?: CompressionOptions): Hooks
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

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (ctx: RateLimitContext) => string; // may run on an early auth rejection
  store?: RateLimitStore;          // default in-memory; use redisRateLimitStore for clusters
  trustProxyHeaders?: boolean;
  retryAfter?: boolean;
  groupId?: string;
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
  | ((ctx) => boolean | Promise<boolean>);`}
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
pickForwardedForByHops(header: string, hops: number): string | undefined;`}
      />

      <h2 id="subdomains-public-suffix-aware">
        Subdomains (Public-Suffix-aware)
      </h2>
      <CodeBlock
        code={`subdomains(hostname: string, opts?: SubdomainsOptions): SubdomainsResult;

interface SubdomainsResult {
  subdomain: string | undefined;       // e.g. "api" for "api.example.co.uk"
  registrableDomain: string | undefined;
  publicSuffix: string | undefined;
}

const PSL_SNAPSHOT_DATE: string;       // ISO date of the bundled PSL snapshot
const MAX_SNAPSHOT_AGE_DAYS: number;   // refuses to use a stale snapshot
const PSL_PUBLIC_SUFFIXES: ReadonlySet<string>;`}
      />

      <p>
        Next up:{" "}
        <Link href={"/docs/api-reference/security" as Route}>
          security &amp; auth helpers
        </Link>
        .
      </p>
    </>
  );
}
