import type { Metadata } from "next";

/**
 * Serialize a JSON-LD payload for safe inline injection inside a
 * `<script type="application/ld+json">` rendered via React's
 * `dangerouslySetInnerHTML`. Defense-in-depth against future regressions if
 * any field ever becomes dynamic: escape `<`, `>`, `&`, and the JS line
 * separators U+2028 / U+2029 so an attacker-controlled value cannot break
 * out of the script tag with `</script>` or terminate the JS context.
 * See Snyk's "10 React security best practices", item #7.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Canonical site URL. Used by `metadataBase`, OpenGraph URLs, sitemap, robots.
 * Override with `NEXT_PUBLIC_SITE_URL` for preview/staging environments.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://daloyjs.dev"
).replace(/\/$/, "");

export const SITE_NAME = "DaloyJS";

export const CORE_PACKAGE_VERSION =
  process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION ?? "1.0.0-rc.5";

export const HOME_TITLE =
  "The first TypeScript REST API framework built for secure AI-assisted services";

export const HOME_DESCRIPTION =
  "DaloyJS combines runtime portability, contract-first OpenAPI, generated typed clients, zero-dependency runtime guardrails, and supply-chain-aware project defaults in one framework.";

export const SITE_TAGLINE =
  "The runtime-portable TypeScript framework with secure-by-default runtime guardrails, hardened pnpm installs, source-verified lockfiles, and typed end-to-end APIs. Optional hardened GitHub Actions bundle for teams on GitHub.";

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
  "Vercel",
  "Bun",
  "Deno",
  "edge runtime",
  "serverless TypeScript",
];

export type PageSeoInput = {
  /** Page title fragment (will be templated as `%s · DaloyJS` by the root layout). */
  title: string;
  /** 140–160 character meta description. */
  description: string;
  /** Path beginning with `/` (e.g. `/docs/routing`). Used for canonical + og:url. */
  path: string;
  /** Additional keywords merged with defaults. */
  keywords?: string[];
  /** Override the og/twitter image. Defaults to `/opengraph-image`. */
  image?: string;
  /** Mark the page as documentation/article instead of website. */
  type?: "website" | "article";
};

function getDefaultImage(path: string): string {
  const normalizedPath = path.replace(/\/$/, "") || "/";

  if (
    normalizedPath === "/blog" ||
    normalizedPath.startsWith("/blog/") ||
    normalizedPath === "/docs" ||
    normalizedPath.startsWith("/docs/")
  ) {
    return `${normalizedPath}/opengraph-image`;
  }

  return "/opengraph-image";
}

/**
 * Build a Next.js `Metadata` object with consistent SEO defaults:
 * canonical URL, OpenGraph, Twitter card, robots, and keyword merging.
 */
export function buildMetadata(input: PageSeoInput): Metadata {
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = `${SITE_URL}${path}`;
  const fullTitle = `${input.title} · ${SITE_NAME}`;
  const image = input.image ?? getDefaultImage(path);
  const keywords = Array.from(
    new Set([...(input.keywords ?? []), ...DEFAULT_KEYWORDS])
  );

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
  };
}
