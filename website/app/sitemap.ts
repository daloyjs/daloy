import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/seo"

/**
 * Static sitemap for website. Add new docs pages here so they are
 * discoverable by search engines.
 */
const STATIC_PATHS: Array<{
  path: string
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]
  priority: number
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1.0 },
  { path: "/blog", changeFrequency: "weekly", priority: 0.8 },
  {
    path: "/blog/the-flow-i-wished-i-had",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/introducing-daloyjs",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/secure-by-default",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/contract-first-without-the-codegen-dance",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/same-app-five-runtimes-verified",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/csrf-in-2026-double-submit-and-fetch-metadata",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/csp-nonces-and-trusted-types-without-tears",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/sessions-on-the-edge",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/supply-chain-hardening-for-typescript-libraries",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/scaffolding-a-production-ready-daloyjs-app-in-60-seconds",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/problem-details-done-right-rfc-9457-errors",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/building-a-bookstore-api-with-daloyjs-from-scratch",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/middleware-without-mystery-hooks-ordering-response-transformation",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/openapi-3-1-extras-webhooks-callbacks-discriminators",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/file-uploads-without-framework-lock-in-multipart-in-daloyjs",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/rate-limiting-that-survives-multiple-instances",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/observability-without-lock-in-structured-logs-and-otel-tracing",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/plugin-lifecycle-events-for-large-team-framework-code",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/daloy-cli-inspecting-routes-schemas-openapi-and-contract-health",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/branded-api-docs-without-losing-the-contract-customizing-scalar-in-daloyjs",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/designing-for-coding-agents-why-daloyjs-scaffolds-agents-md-and-skills",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/blog/ai-friendly-route-metadata-machine-readable-examples-for-codegen-agents",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  { path: "/docs", changeFrequency: "weekly", priority: 0.9 },
  { path: "/docs/installation", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/scaffolder", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/cli", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/getting-started", changeFrequency: "monthly", priority: 0.9 },
  { path: "/docs/routing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/validation", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/validation/zod", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/validation/valibot", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/plugins", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/errors", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/multipart", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/openapi", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/ai-metadata", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/typed-client", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/streaming", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/websocket", changeFrequency: "monthly", priority: 0.8 },
  {
    path: "/docs/architecture/modular-monolith",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  { path: "/docs/security", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/security/csrf", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/security/session", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/adapters", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/deployment", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/testing", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/api-reference", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/orm/prisma", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/drizzle", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/typeorm", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/sequelize", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/supabase", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/odm", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/odm/mongoose", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/odm/ottoman", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/databases", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/databases/neon", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/docs/databases/planetscale",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  { path: "/docs/databases/turso", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/docs/databases/cloudflare-d1",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/docs/databases/aurora-dsql",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  { path: "/docs/email", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/email/aws-ses", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/email/sendgrid", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/email/resend", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/email/postmark", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/email/mailgun", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/email/mailtrap", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/auth", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/auth/aws-cognito", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/auth/entra-id", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/auth/auth0", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/auth/okta", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/auth/clerk", changeFrequency: "monthly", priority: 0.7 },
  {
    path: "/docs/tutorials/bookstore",
    changeFrequency: "monthly",
    priority: 0.7,
  },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return STATIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }))
}
