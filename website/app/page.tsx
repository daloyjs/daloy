import { HomePage } from "@/components/home/home-page";
import { HOME_COPY_EN } from "@/components/home/home-copy-en";
import {
  buildMetadata,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
  HOME_DESCRIPTION,
  HOME_TITLE,
} from "@/lib/seo";

export const metadata = buildMetadata({
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  path: "/",
  translatedPath: "/",
  keywords: [
    "DaloyJS",
    "secure by default",
    "secure-by-default framework",
    "secure JavaScript framework",
    "portable supply-chain hardening",
    "supply-chain attack protection",
    "slopsquatting protection",
    "AI-era supply chain security",
    "vibe coding security",
    "secure vibe coding framework",
    "AI-generated code security",
    "runtime-portable framework",
    "TypeScript HTTP framework",
    "contract-first TypeScript",
    "OpenAPI 3.1 framework",
    "edge framework",
    "OpenTelemetry tracing",
    "SSE NDJSON streaming",
    "blocked install scripts",
    "source-verified lockfiles",
    "zero runtime dependencies",
    "hardened GitHub Actions bundle",
    "create-daloy",
    "MCP endpoint",
    "Model Context Protocol",
    "MCP documentation server",
    "AI agent docs",
  ],
});

export default function Page() {
  // Connected entity graph for search engines. The goal is entity
  // *disambiguation*: explicit `alternateName` spellings plus `sameAs` links to
  // the canonical GitHub/npm/JSR/social profiles tell Google that "DaloyJS" is a
  // distinct named entity, not a misspelling of the similarly named "dayjs".
  // `@id` references connect the Organization, WebSite, and SoftwareApplication
  // into one graph rather than three unrelated nodes. Organization includes
  // contactPoint + PostalAddress so agents can verify the project is real.
  const jsonLd = [
    buildOrganizationJsonLd(),
    buildWebSiteJsonLd(),
    buildSoftwareApplicationJsonLd(),
  ];

  return <HomePage copy={HOME_COPY_EN} jsonLd={jsonLd} />;
}
