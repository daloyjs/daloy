import type { Metadata } from "next"

/**
 * Canonical site URL. Used by `metadataBase`, OpenGraph URLs, sitemap, robots.
 * Override with `NEXT_PUBLIC_SITE_URL` for preview/staging environments.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://daloyjs.dev"
).replace(/\/$/, "")

export const SITE_NAME = "DaloyJS"

export const CORE_PACKAGE_VERSION =
  process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION ?? "0.30.0"

export const SITE_TAGLINE =
  "Runtime-portable TypeScript web framework with contract-first routing, validation, OpenAPI, and a typed client."

export const DEFAULT_KEYWORDS = [
  "DaloyJS",
  "TypeScript web framework",
  "Node.js framework",
  "contract-first API",
  "OpenAPI generator",
  "typed API client",
  "Hey API",
  "Zod validation",
  "Cloudflare Workers",
  "Vercel Edge",
  "Bun",
  "Deno",
  "edge runtime",
  "serverless TypeScript",
]

export type PageSeoInput = {
  /** Page title fragment (will be templated as `%s · DaloyJS` by the root layout). */
  title: string
  /** 140–160 character meta description. */
  description: string
  /** Path beginning with `/` (e.g. `/docs/routing`). Used for canonical + og:url. */
  path: string
  /** Additional keywords merged with defaults. */
  keywords?: string[]
  /** Override the og/twitter image. Defaults to `/opengraph-image`. */
  image?: string
  /** Mark the page as documentation/article instead of website. */
  type?: "website" | "article"
}

/**
 * Build a Next.js `Metadata` object with consistent SEO defaults:
 * canonical URL, OpenGraph, Twitter card, robots, and keyword merging.
 */
export function buildMetadata(input: PageSeoInput): Metadata {
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`
  const url = `${SITE_URL}${path}`
  const fullTitle = `${input.title} · ${SITE_NAME}`
  const image = input.image ?? "/opengraph-image"
  const keywords = Array.from(
    new Set([...(input.keywords ?? []), ...DEFAULT_KEYWORDS])
  )

  return {
    title: input.title,
    description: input.description,
    keywords,
    alternates: { canonical: path },
    openGraph: {
      type: input.type ?? "website",
      url,
      siteName: SITE_NAME,
      title: fullTitle,
      description: input.description,
      images: [{ url: image, width: 1200, height: 630, alt: fullTitle }],
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.description,
      images: [image],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  }
}
