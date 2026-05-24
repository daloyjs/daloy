import type { Route } from "next";

export type DocsNavItem = { title: string; href: Route }
export type DocsNavSection = { title: string; items: DocsNavItem[] }

export const docsNav: DocsNavSection[] = [
  {
    title: "Get started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Installation", href: "/docs/installation" },
      { title: "Scaffold a project", href: "/docs/scaffolder" },
      { title: "CLI inspector", href: "/docs/cli" },
      { title: "Getting started", href: "/docs/getting-started" },
    ],
  },
  {
    title: "Core concepts",
    items: [
      { title: "Routing", href: "/docs/routing" },
      { title: "Validation overview", href: "/docs/validation" },
      { title: "Zod", href: "/docs/validation/zod" },
      { title: "Valibot", href: "/docs/validation/valibot" },
      { title: "Plugins & encapsulation", href: "/docs/plugins" },
      { title: "Errors & problem+json", href: "/docs/errors" },
      { title: "File uploads (multipart)", href: "/docs/multipart" },
    ],
  },
  {
    title: "Contracts & clients",
    items: [
      { title: "OpenAPI generation", href: "/docs/openapi" },
      { title: "AI-friendly route metadata", href: "/docs/ai-metadata" },
      { title: "Typed clients (Hey API)", href: "/docs/typed-client" },
      { title: "Streaming (SSE & NDJSON)", href: "/docs/streaming" },
      { title: "WebSocket primitives", href: "/docs/websocket" },
      { title: "Tracing (OpenTelemetry)", href: "/docs/tracing" },
      { title: "Testing & contract tests", href: "/docs/testing" },
    ],
  },
  {
    title: "Architecture",
    items: [
      {
        title: "Modular monolith",
        href: "/docs/architecture/modular-monolith",
      },
    ],
  },
  {
    title: "Data access",
    items: [
      { title: "ORM overview", href: "/docs/orm" },
      { title: "Prisma", href: "/docs/orm/prisma" },
      { title: "Drizzle ORM", href: "/docs/orm/drizzle" },
      { title: "TypeORM", href: "/docs/orm/typeorm" },
      { title: "MikroORM", href: "/docs/orm/mikro-orm" },
      { title: "Sequelize", href: "/docs/orm/sequelize" },
      { title: "Supabase platform", href: "/docs/orm/supabase" },
      { title: "ODM overview", href: "/docs/odm" },
      { title: "Mongoose", href: "/docs/odm/mongoose" },
      { title: "Ottoman", href: "/docs/odm/ottoman" },
    ],
  },
  {
    title: "Database hosting",
    items: [
      { title: "Overview", href: "/docs/databases" },
      { title: "Neon", href: "/docs/databases/neon" },
      { title: "PlanetScale", href: "/docs/databases/planetscale" },
      { title: "Turso (libSQL)", href: "/docs/databases/turso" },
      { title: "Cloudflare D1", href: "/docs/databases/cloudflare-d1" },
      { title: "AWS Aurora DSQL", href: "/docs/databases/aurora-dsql" },
    ],
  },
  {
    title: "Email",
    items: [
      { title: "Overview", href: "/docs/email" },
      { title: "AWS SES", href: "/docs/email/aws-ses" },
      { title: "SendGrid", href: "/docs/email/sendgrid" },
      { title: "Resend", href: "/docs/email/resend" },
      { title: "Postmark", href: "/docs/email/postmark" },
      { title: "Mailgun", href: "/docs/email/mailgun" },
      { title: "Mailtrap", href: "/docs/email/mailtrap" },
    ],
  },
  {
    title: "Payments",
    items: [
      { title: "Overview", href: "/docs/payments" as Route },
      { title: "Shopify", href: "/docs/payments/shopify" as Route },
      { title: "Braintree (PayPal)", href: "/docs/payments/braintree" as Route },
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
      { title: "Overview", href: "/docs/auth" },
      { title: "AWS Cognito", href: "/docs/auth/aws-cognito" },
      { title: "Microsoft Entra ID", href: "/docs/auth/entra-id" },
      { title: "Auth0", href: "/docs/auth/auth0" },
      { title: "Okta", href: "/docs/auth/okta" },
      { title: "Clerk", href: "/docs/auth/clerk" },
    ],
  },
  {
    title: "Production",
    items: [
      { title: "Security", href: "/docs/security" },
      { title: "OWASP API Top 10 mapping", href: "/docs/security/owasp-api-top-10" as Route },
      { title: "Runtime protections (portable)", href: "/docs/security/runtime-protections" as Route },
      { title: "Secure-by-default", href: "/docs/security/secure-defaults" },
      { title: "Boot guards", href: "/docs/security/boot-guards" },
      { title: "Lifecycle & health", href: "/docs/security/lifecycle-health" },
      { title: "Composition & network", href: "/docs/security/composition-network" },
      { title: "Lifecycle leftovers", href: "/docs/security/lifecycle-leftovers" },
      { title: "Auth slice", href: "/docs/security/auth-slice" },
      { title: "WebSocket + login throttle", href: "/docs/security/websocket-login-throttle" },
      { title: "Compression", href: "/docs/security/compression" as Route },
      { title: "secureDefaults enforcement", href: "/docs/security/secure-defaults-enforcement" as Route },
      { title: "CSRF protection", href: "/docs/security/csrf" },
      { title: "SQL injection", href: "/docs/security/sql-injection" as Route },
      { title: "Command injection", href: "/docs/security/command-injection" as Route },
      { title: "SSRF guard (fetchGuard)", href: "/docs/security/fetch-guard" as Route },
      { title: "Secure admin panels", href: "/docs/security/admin-panels" as Route },
      { title: "Sessions", href: "/docs/security/session" },
      {
        title: "Redis rate-limit store",
        href: "/docs/security/rate-limit-redis",
      },
      { title: "Supply-chain security", href: "/docs/security/supply-chain" },
      { title: "Scanning tools (Socket, Snyk, Aikido)", href: "/docs/security/scanning-tools" as Route },
      { title: "Compliance posture", href: "/docs/security/compliance" as Route },
      { title: "Deployment", href: "/docs/deployment" },
      { title: "Fly.io", href: "/docs/deployment/fly-io" as Route },
      { title: "Render", href: "/docs/deployment/render" as Route },
      { title: "Railway", href: "/docs/deployment/railway" as Route },
      { title: "Heroku", href: "/docs/deployment/heroku" as Route },
    ],
  },
  {
    title: "Adapters & runtimes",
    items: [
      { title: "Overview", href: "/docs/adapters" },
      { title: "Node.js", href: "/docs/adapters/node" as Route },
      { title: "Bun", href: "/docs/adapters/bun" as Route },
      { title: "Deno", href: "/docs/adapters/deno" as Route },
      { title: "Cloudflare Workers", href: "/docs/adapters/cloudflare-workers" as Route },
      { title: "Vercel", href: "/docs/adapters/vercel" as Route },
      { title: "Netlify", href: "/docs/adapters/netlify" as Route },
      { title: "Fastly Compute", href: "/docs/adapters/fastly" as Route },
      { title: "AWS Lambda", href: "/docs/adapters/aws-lambda" as Route },
    ],
  },
  {
    title: "Tutorials",
    items: [
      { title: "Build a bookstore API", href: "/docs/tutorials/bookstore" },
      { title: "Large fake REST demo", href: "/docs/tutorials/fake-rest-api" },
    ],
  },
  {
    title: "Reference",
    items: [{ title: "API reference", href: "/docs/api-reference" }],
  },
]
