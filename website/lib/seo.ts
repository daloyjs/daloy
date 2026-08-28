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

/** Public maintainer inbox. Also used in Organization JSON-LD. */
export const ORGANIZATION_EMAIL = "daloyjs@gmail.com";

/** JSON-LD `@id` for the DaloyJS Organization node. */
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/** JSON-LD `@id` for the DaloyJS WebSite node. */
export const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * Spellings of the project name. Used as `alternateName` so search engines and
 * agents do not collapse "DaloyJS" into similarly named packages.
 */
export const BRAND_ALTERNATE_NAMES = [
  "DaloyJS",
  "Daloy.js",
  "Daloy JS",
  "Daloy",
] as const;

/**
 * Canonical public profiles for the same Organization entity. `sameAs` is how
 * agents verify the GitHub/npm/JSR/social accounts belong to this site.
 */
export const BRAND_PROFILES = [
  "https://github.com/daloyjs/daloy",
  "https://www.npmjs.com/package/@daloyjs/core",
  "https://jsr.io/@daloyjs/daloy",
  "https://x.com/daloyjs",
  "https://bsky.app/profile/daloyjs.dev",
  "https://mastodon.social/@daloyjs",
  "https://www.instagram.com/daloyjs",
  "https://dev.to/daloyjs",
  "https://opencollective.com/daloyjs",
] as const;

export const CORE_PACKAGE_VERSION =
  process.env.NEXT_PUBLIC_CORE_PACKAGE_VERSION ?? "1.3.0";

export const HOME_TITLE =
  "The first TypeScript REST API framework built for secure AI-assisted services";

export const HOME_DESCRIPTION =
  "Any framework can route a request. DaloyJS adds what the others don't: secure-by-default guardrails, zero runtime dependencies, and OpenAPI 3.1 with typed clients.";

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
/**
 * Whether a site path is a documentation page, and therefore has a markdown
 * sibling served by `app/docs-md/[[...slug]]/route.ts`.
 *
 * `/docs/llms.txt` is a route handler rather than a docs page, so it is
 * excluded; it never calls {@link buildMetadata}, but the check keeps the
 * predicate honest for callers that might.
 *
 * @param path - Site-absolute path, e.g. `/docs/routing`.
 * @returns `true` when a `.md` sibling exists for the path.
 */
function isDocsPath(path: string): boolean {
  return (
    (path === "/docs" || path.startsWith("/docs/")) &&
    !path.endsWith(".md") &&
    !path.endsWith("/llms.txt")
  );
}

export function buildMetadata(input: PageSeoInput): Metadata {
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const url = `${SITE_URL}${path}`;
  const fullTitle = `${input.title} · ${SITE_NAME}`;
  const image = input.image ?? getDefaultImage(path);
  const keywords = Array.from(
    new Set([...(input.keywords ?? []), ...DEFAULT_KEYWORDS]),
  );

  return {
    title: input.title,
    description: input.description,
    keywords,
    alternates: {
      canonical: path,
      // llms.txt v2 link relation: every docs page has a markdown sibling at
      // the same URL with `.md` appended, and says so in its `<head>`. The
      // matching `rel="describedby"` pointer, and the header form of both
      // relations, are set in proxy.ts.
      ...(isDocsPath(path) ? { types: { "text/markdown": `${path}.md` } } : {}),
    },
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

/**
 * Organization JSON-LD for DaloyJS.
 *
 * Includes `contactPoint` (email + contactType + url) and `address`
 * (PostalAddress). The project is not a registered company with a public
 * street office; the honest PostalAddress is the maintainer's country
 * (Norway). Inventing a street number would fail the whole point of this
 * node, which is that agents can verify who we are.
 */
export function buildOrganizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    alternateName: [...BRAND_ALTERNATE_NAMES],
    url: SITE_URL,
    logo: `${SITE_URL}/opengraph-image`,
    description: HOME_DESCRIPTION,
    email: ORGANIZATION_EMAIL,
    sameAs: [...BRAND_PROFILES],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "technical support",
      email: ORGANIZATION_EMAIL,
      url: `${SITE_URL}/contact`,
      availableLanguage: ["English"],
    },
    address: {
      "@type": "PostalAddress",
      addressCountry: "NO",
    },
  };
}

/**
 * WebSite JSON-LD pointing at the Organization publisher.
 */
export function buildWebSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    alternateName: [...BRAND_ALTERNATE_NAMES],
    url: SITE_URL,
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

/**
 * SoftwareApplication JSON-LD for the DaloyJS package itself.
 */
export function buildSoftwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    alternateName: [...BRAND_ALTERNATE_NAMES],
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Cross-platform",
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    programmingLanguage: "TypeScript",
    license: "https://opensource.org/licenses/MIT",
    softwareVersion: CORE_PACKAGE_VERSION,
    downloadUrl: "https://www.npmjs.com/package/@daloyjs/core",
    codeRepository: "https://github.com/daloyjs/daloy",
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    sameAs: [...BRAND_PROFILES],
  };
}
