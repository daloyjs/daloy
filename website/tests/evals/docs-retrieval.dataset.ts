/**
 * Docs-retrieval eval dataset: questions an AI coding agent realistically
 * sends to the DaloyJS docs MCP `search_docs` tool (or the site search), each
 * paired with the page(s) that answer it.
 *
 * Grow this from real misses: when an agent (or a person) searches and the
 * right page is not in the top results, add the query here with the page that
 * should have won, then improve ranking, keywords, or descriptions until
 * `docs-retrieval.test.ts` reports it as a hit. Never "fix" a miss by editing
 * the expectation to whatever currently ranks first.
 */

/** One labelled query. */
export interface RetrievalCase {
  /** The query text, phrased the way an agent or user would type it. */
  readonly query: string;
  /** Docs routes that correctly answer it; the first hit among these counts. */
  readonly relevant: readonly string[];
}

export const RETRIEVAL_CASES: readonly RetrievalCase[] = [
  // Getting started
  { query: "install daloyjs", relevant: ["/docs/installation"] },
  { query: "create a new project with the scaffolder", relevant: ["/docs/scaffolder", "/docs/getting-started"] },
  { query: "define a route with params", relevant: ["/docs/routing"] },
  { query: "validate request body with zod", relevant: ["/docs/validation/zod", "/docs/validation"] },
  { query: "valibot schema validation", relevant: ["/docs/validation/valibot"] },
  { query: "generate a typed client from openapi", relevant: ["/docs/typed-client"] },
  { query: "openapi spec generation", relevant: ["/docs/openapi"] },
  { query: "testing routes with app.request", relevant: ["/docs/testing"] },
  { query: "problem+json error responses", relevant: ["/docs/errors"] },
  { query: "structured logging", relevant: ["/docs/logging"] },

  // Security (the topics agents most often get wrong)
  { query: "csrf protection", relevant: ["/docs/security/csrf"] },
  { query: "rate limit with redis", relevant: ["/docs/security/rate-limit-redis"] },
  { query: "per-route body size limit", relevant: ["/docs/security/route-limits"] },
  { query: "server side request forgery outbound fetch", relevant: ["/docs/security/fetch-guard"] },
  { query: "hash passwords", relevant: ["/docs/security/hashing"] },
  { query: "session cookies", relevant: ["/docs/security/session", "/docs/security/cookies"] },
  { query: "sql injection", relevant: ["/docs/security/sql-injection"] },
  { query: "open redirect", relevant: ["/docs/security/safe-redirect"] },
  { query: "owasp api top 10", relevant: ["/docs/security/owasp-api-top-10"] },
  { query: "supply chain security pnpm", relevant: ["/docs/security/supply-chain"] },
  { query: "secure defaults", relevant: ["/docs/security/secure-defaults"] },
  { query: "verify jwt with jwks", relevant: ["/docs/security/auth-slice", "/docs/auth", "/docs/api-reference/security"] },
  { query: "web application firewall", relevant: ["/docs/waf"] },
  { query: "block countries geo", relevant: ["/docs/geo-block"] },

  // Platform and integrations
  { query: "deploy to cloudflare workers", relevant: ["/docs/adapters/cloudflare-workers"] },
  { query: "aws lambda adapter", relevant: ["/docs/adapters/aws-lambda"] },
  { query: "run on bun", relevant: ["/docs/adapters/bun"] },
  { query: "deploy to railway", relevant: ["/docs/deployment/railway"] },
  { query: "prisma orm", relevant: ["/docs/orm/prisma"] },
  { query: "drizzle", relevant: ["/docs/orm/drizzle"] },
  { query: "mongoose", relevant: ["/docs/odm/mongoose"] },
  { query: "stripe webhooks", relevant: ["/docs/payments/stripe"] },
  { query: "send email with resend", relevant: ["/docs/email/resend"] },
  { query: "clerk authentication", relevant: ["/docs/auth/clerk"] },

  // Features
  { query: "background jobs queue", relevant: ["/docs/jobs"] },
  { query: "cron scheduler", relevant: ["/docs/scheduler"] },
  { query: "websocket", relevant: ["/docs/websocket"] },
  { query: "server sent events streaming", relevant: ["/docs/streaming"] },
  { query: "idempotency key", relevant: ["/docs/idempotency"] },
  { query: "file upload multipart", relevant: ["/docs/multipart"] },
  { query: "cursor pagination", relevant: ["/docs/pagination"] },
  { query: "opentelemetry tracing", relevant: ["/docs/tracing", "/docs/otlp"] },
  { query: "prometheus metrics", relevant: ["/docs/metrics"] },
  { query: "model context protocol server", relevant: ["/docs/mcp"] },
  { query: "migrate from express", relevant: ["/docs/migrating/express"] },
  { query: "api versioning", relevant: ["/docs/api-versioning"] },
];
