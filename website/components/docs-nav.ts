import type { Route } from "next";

/**
 * A sidebar entry. `badge` flags a page in the sidebar (e.g. a feature that
 * shipped in the latest release); remove it once the release is no longer new.
 */
export type DocsNavItem = { title: string; href: Route; badge?: "new" | "beta" };
export type DocsNavSection = { title: string; items: DocsNavItem[] };

/**
 * Docs sidebar navigation, ordered as a learning path: a short beginner
 * track first ("Start here" → "Tutorials"), core concepts and the contract
 * workflow next, advanced and security topics in their own focused sections
 * after that, then the integration catalogs, deployment, and the reference.
 *
 * Keep sections small: the sidebar opens one section at a time, so a section
 * is the unit readers scan. When a section grows past roughly a dozen items,
 * split it instead of letting it sprawl.
 */
export const docsNav: DocsNavSection[] = [
  {
    title: "Start here",
    items: [
      { title: "Introduction", href: "/docs" as Route },
      { title: "Installation", href: "/docs/installation" as Route },
      { title: "Getting started", href: "/docs/getting-started" as Route },
      { title: "Scaffold a project", href: "/docs/scaffolder" as Route },
      { title: "Where to use DaloyJS", href: "/docs/where-to-use" as Route },
    ],
  },
  {
    title: "Tutorials",
    items: [
      { title: "Build a bookstore API", href: "/docs/tutorials/bookstore" as Route },
      {
        title: "Build a multi-user API",
        href: "/docs/tutorials/multi-user-api" as Route,
      },
      { title: "Large fake REST demo", href: "/docs/tutorials/fake-rest-api" as Route },
      { title: "Host an agent loop", href: "/docs/tutorials/agent-loop" as Route, badge: "new" },
    ],
  },
  {
    title: "Migrating",
    items: [
      { title: "From Express.js", href: "/docs/migrating/express" as Route },
    ],
  },
  {
    title: "Core concepts",
    items: [
      { title: "Routing", href: "/docs/routing" as Route },
      { title: "Validation overview", href: "/docs/validation" as Route },
      { title: "Zod", href: "/docs/validation/zod" as Route },
      { title: "Valibot", href: "/docs/validation/valibot" as Route },
      { title: "Errors & problem+json", href: "/docs/errors" as Route },
      { title: "Plugins & encapsulation", href: "/docs/plugins" as Route },
      { title: "Middleware combinators", href: "/docs/combinators" as Route },
      { title: "Config validation", href: "/docs/config" as Route },
      { title: "Structured logging", href: "/docs/logging" as Route },
    ],
  },
  {
    title: "OpenAPI & typed clients",
    items: [
      { title: "DaloyJS OpenAPI spec", href: "/docs/openapi" as Route },
      { title: "daloyjs.dev API reference", href: "/docs/openapi/site-api" as Route, badge: "new" },
      { title: "API versioning", href: "/docs/api-versioning" as Route },
      { title: "Typed clients (Hey API)", href: "/docs/typed-client" as Route },
      {
        title: "API lifecycle & breaking changes",
        href: "/docs/api-lifecycle" as Route,
      },
      { title: "Testing & contract tests", href: "/docs/testing" as Route },
      { title: "AI-friendly route metadata", href: "/docs/ai-metadata" as Route },
      { title: "llms.txt for agents", href: "/docs/llms-txt" as Route },
      { title: "DaloyJS MCP server", href: "/docs/mcp" as Route },
      { title: "A2A agent endpoint", href: "/docs/a2a" as Route, badge: "new" },
      { title: "Vercel AI SDK", href: "/docs/ai-sdk" as Route },
    ],
  },
  {
    title: "Advanced features",
    items: [
      { title: "File uploads (multipart)", href: "/docs/multipart" as Route },
      { title: "Idempotency keys", href: "/docs/idempotency" as Route },
      { title: "Response caching", href: "/docs/response-cache" as Route },
      { title: "Pagination", href: "/docs/pagination" as Route },
      { title: "Multitenancy", href: "/docs/multitenancy" as Route },
      { title: "Streaming (SSE & NDJSON)", href: "/docs/streaming" as Route },
      { title: "WebSocket primitives", href: "/docs/websocket" as Route },
      { title: "AsyncAPI for WebSockets", href: "/docs/asyncapi" as Route },
      { title: "Scheduled tasks (cron)", href: "/docs/scheduler" as Route },
      { title: "Background jobs", href: "/docs/jobs" as Route },
      {
        title: "Modular monolith",
        href: "/docs/architecture/modular-monolith" as Route,
      },
      { title: "CLI inspector", href: "/docs/cli" as Route },
    ],
  },
  {
    title: "Observability",
    items: [
      { title: "Tracing (OpenTelemetry)", href: "/docs/tracing" as Route },
      { title: "Metrics (Prometheus)", href: "/docs/metrics" as Route },
      { title: "OTLP export (OTel push)", href: "/docs/otlp" as Route },
    ],
  },
  {
    title: "Security essentials",
    items: [
      { title: "Security overview", href: "/docs/security" as Route },
      { title: "Secure-by-default", href: "/docs/security/secure-defaults" as Route },
      {
        title: "OWASP API Top 10 mapping",
        href: "/docs/security/owasp-api-top-10" as Route,
      },
      {
        title: "Resource authorization (BOLA / IDOR)",
        href: "/docs/security/resource-authorization" as Route,
      },
      { title: "JWT & auth safeguards", href: "/docs/security/auth-slice" as Route },
      { title: "Sessions", href: "/docs/security/session" as Route },
      { title: "CSRF protection", href: "/docs/security/csrf" as Route },
      { title: "Cookie helpers", href: "/docs/security/cookies" as Route },
      { title: "Password hashing", href: "/docs/security/hashing" as Route },
    ],
  },
  {
    title: "Attack protection",
    items: [
      { title: "SQL injection", href: "/docs/security/sql-injection" as Route },
      {
        title: "Command injection",
        href: "/docs/security/command-injection" as Route,
      },
      {
        title: "SSRF guard (fetchGuard)",
        href: "/docs/security/fetch-guard" as Route,
      },
      {
        title: "Open redirect protection",
        href: "/docs/security/safe-redirect" as Route,
      },
      {
        title: "IP allow/deny lists",
        href: "/docs/security/ip-restriction" as Route,
      },
      { title: "WAF-lite inspection", href: "/docs/waf" as Route },
      {
        title: "Request decompression guard",
        href: "/docs/request-decompression" as Route,
      },
      {
        title: "Bot / User-Agent management",
        href: "/docs/bot-guard" as Route,
      },
      { title: "Adaptive auto-ban", href: "/docs/auto-ban" as Route },
      {
        title: "IP reputation / denylist feed",
        href: "/docs/ip-reputation" as Route,
      },
      { title: "GeoIP / geo-blocking", href: "/docs/geo-block" as Route },
      {
        title: "Concurrency limits + queueing",
        href: "/docs/concurrency-limit" as Route,
      },
      {
        title: "WebSocket & login safeguards",
        href: "/docs/security/websocket-login-throttle" as Route,
      },
      {
        title: "Secure admin panels",
        href: "/docs/security/admin-panels" as Route,
      },
    ],
  },
  {
    title: "Hardening & operations",
    items: [
      { title: "Boot guards", href: "/docs/security/boot-guards" as Route },
      {
        title: "secureDefaults enforcement",
        href: "/docs/security/secure-defaults-enforcement" as Route,
      },
      {
        title: "Runtime protections (portable)",
        href: "/docs/security/runtime-protections" as Route,
      },
      { title: "Lifecycle & health", href: "/docs/security/lifecycle-health" as Route },
      {
        title: "Runtime resilience and configuration",
        href: "/docs/security/lifecycle-leftovers" as Route,
      },
      {
        title: "Composition & network",
        href: "/docs/security/composition-network" as Route,
      },
      {
        title: "Internal services & meshes",
        href: "/docs/security/internal-service-preset" as Route,
      },
      { title: "Compression", href: "/docs/security/compression" as Route },
      { title: "mTLS / client certificates", href: "/docs/mtls" as Route },
      {
        title: "HTTP message signatures (RFC 9421)",
        href: "/docs/http-signatures" as Route,
      },
      {
        title: "Redis rate-limit store",
        href: "/docs/security/rate-limit-redis" as Route,
      },
      {
        title: "Docs UI asset integrity (SRI)",
        href: "/docs/docs-asset-integrity" as Route,
      },
      { title: "Supply-chain security", href: "/docs/security/supply-chain" as Route },
      {
        title: "Scanning tools (Socket, Snyk, Aikido)",
        href: "/docs/security/scanning-tools" as Route,
      },
      {
        title: "Compliance posture",
        href: "/docs/security/compliance" as Route,
      },
    ],
  },
  {
    title: "Outbound & webhooks",
    items: [
      {
        title: "Outbound resilience (fetch)",
        href: "/docs/fetch-resilience" as Route,
      },
      { title: "DaloyJS webhooks", href: "/docs/webhook-delivery" as Route },
    ],
  },
  {
    title: "Data access",
    items: [
      { title: "ORM overview", href: "/docs/orm" as Route },
      { title: "Prisma", href: "/docs/orm/prisma" as Route },
      { title: "Drizzle ORM", href: "/docs/orm/drizzle" as Route },
      { title: "TypeORM", href: "/docs/orm/typeorm" as Route },
      { title: "MikroORM", href: "/docs/orm/mikro-orm" as Route },
      { title: "Sequelize", href: "/docs/orm/sequelize" as Route },
      { title: "Supabase platform", href: "/docs/orm/supabase" as Route },
      { title: "ODM overview", href: "/docs/odm" as Route },
      { title: "Mongoose", href: "/docs/odm/mongoose" as Route },
      { title: "Ottoman", href: "/docs/odm/ottoman" as Route },
    ],
  },
  {
    title: "Database hosting",
    items: [
      { title: "Overview", href: "/docs/databases" as Route },
      { title: "Neon", href: "/docs/databases/neon" as Route },
      { title: "PlanetScale", href: "/docs/databases/planetscale" as Route },
      { title: "Turso (libSQL)", href: "/docs/databases/turso" as Route },
      { title: "DuckDB", href: "/docs/databases/duckdb" as Route },
      { title: "Cloudflare D1", href: "/docs/databases/cloudflare-d1" as Route },
      { title: "AWS Aurora DSQL", href: "/docs/databases/aurora-dsql" as Route },
    ],
  },
  {
    title: "Email",
    items: [
      { title: "Overview", href: "/docs/email" as Route },
      { title: "AWS SES", href: "/docs/email/aws-ses" as Route },
      { title: "SendGrid", href: "/docs/email/sendgrid" as Route },
      { title: "Resend", href: "/docs/email/resend" as Route },
      { title: "Postmark", href: "/docs/email/postmark" as Route },
      { title: "Mailgun", href: "/docs/email/mailgun" as Route },
      { title: "Mailtrap", href: "/docs/email/mailtrap" as Route },
    ],
  },
  {
    title: "Payments",
    items: [
      { title: "Overview", href: "/docs/payments" as Route },
      { title: "Stripe", href: "/docs/payments/stripe" as Route },
      { title: "Shopify", href: "/docs/payments/shopify" as Route },
      {
        title: "Braintree (PayPal)",
        href: "/docs/payments/braintree" as Route,
      },
      { title: "Authorize.Net", href: "/docs/payments/authorize-net" as Route },
      { title: "Adyen", href: "/docs/payments/adyen" as Route },
      { title: "Mollie", href: "/docs/payments/mollie" as Route },
      { title: "Tap Payments", href: "/docs/payments/tap" as Route },
      { title: "PayTabs", href: "/docs/payments/paytabs" as Route },
      { title: "Razorpay", href: "/docs/payments/razorpay" as Route },
      { title: "Square", href: "/docs/payments/square" as Route },
    ],
  },
  {
    title: "Authentication",
    items: [
      { title: "DaloyJS auth docs", href: "/docs/auth" as Route },
      {
        title: "Architecture (OAuth2 / OIDC)",
        href: "/docs/auth/architecture" as Route,
      },
      { title: "AWS Cognito", href: "/docs/auth/aws-cognito" as Route },
      { title: "Microsoft Entra ID", href: "/docs/auth/entra-id" as Route },
      { title: "Auth0", href: "/docs/auth/auth0" as Route },
      { title: "Okta", href: "/docs/auth/okta" as Route },
      { title: "Clerk", href: "/docs/auth/clerk" as Route },
      { title: "LoginRadius", href: "/docs/auth/loginradius" as Route },
      { title: "Better Auth", href: "/docs/auth/better-auth" as Route },
    ],
  },
  {
    title: "Deployment",
    items: [
      { title: "Overview", href: "/docs/deployment" as Route },
      { title: "Fly.io", href: "/docs/deployment/fly-io" as Route },
      { title: "Render", href: "/docs/deployment/render" as Route },
      { title: "Railway", href: "/docs/deployment/railway" as Route },
      { title: "Heroku", href: "/docs/deployment/heroku" as Route },
      { title: "Replit", href: "/docs/deployment/replit" as Route },
    ],
  },
  {
    title: "Adapters & runtimes",
    items: [
      { title: "Overview", href: "/docs/adapters" as Route },
      { title: "Node.js", href: "/docs/adapters/node" as Route },
      { title: "Bun", href: "/docs/adapters/bun" as Route },
      { title: "Deno", href: "/docs/adapters/deno" as Route },
      {
        title: "Cloudflare Workers",
        href: "/docs/adapters/cloudflare-workers" as Route,
      },
      { title: "Vercel", href: "/docs/adapters/vercel" as Route },
      { title: "Netlify", href: "/docs/adapters/netlify" as Route },
      { title: "Fastly Compute", href: "/docs/adapters/fastly" as Route },
      { title: "AWS Lambda", href: "/docs/adapters/aws-lambda" as Route },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "DaloyJS API docs", href: "/docs/api-reference" as Route },
      { title: "App & routing", href: "/docs/api-reference/app" as Route },
      {
        title: "Middleware & helpers",
        href: "/docs/api-reference/middleware" as Route,
      },
      {
        title: "Security & auth",
        href: "/docs/api-reference/security" as Route,
      },
      {
        title: "Feature modules",
        href: "/docs/api-reference/modules" as Route,
      },
      {
        title: "Runtime adapters",
        href: "/docs/api-reference/adapters" as Route,
      },
    ],
  },
];
