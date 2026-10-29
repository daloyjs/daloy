import type { ReactNode } from "react";

import type { BenchmarkChartsCopy } from "@/components/benchmark-charts";
import type { ContractFlowCopy } from "@/components/contract-flow-visual";
import type { SiteLocale } from "@/lib/i18n";

/** Keys of the security/architecture bento cards, in display order. */
export const FEATURE_KEYS = [
  "secureDefaults",
  "zeroDeps",
  "supplyChain",
  "aiNative",
  "streaming",
  "portable",
  "contractFirst",
  "typedClients",
  "batteries",
] as const;

/** One bento card key. */
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Prose of one bento card (icon, span and accent live in the component). */
export type FeatureCopy = {
  title: string;
  body: string;
  badges?: readonly string[];
  stat?: { value: string; label: string };
};

/** Docs MCP tool names shown on the home page. */
export type McpToolName = "search_docs" | "get_doc" | "list_docs";

/**
 * Every piece of locale-specific content on the landing page. Each locale
 * file must provide all of it, so a section added to the English page fails
 * the typecheck until it is translated.
 */
export type HomeCopy = {
  locale: SiteLocale;
  /**
   * Internal link targets. Spanish points at `/es/docs` where a page is
   * translated and at the English docs elsewhere; `LocaleLink` decides per
   * link whether that is a client navigation or a full document load.
   */
  links: {
    gettingStarted: string;
    docs: string;
    installation: string;
    tutorial: string;
    mcp: string;
    openapi: string;
    blog: string;
  };
  /** Pill above the hero headline pointing at the other locale. */
  languageNotice: {
    badge: string;
    text: string;
    cta: string;
    href: string;
    /** BCP 47 tag of the notice text (the target locale's language). */
    lang: string;
  };
  hero: {
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    /** Shown under the CTAs when the docs are in another language. */
    contentLanguageNote?: string;
    factsLabel: string;
    facts: readonly string[];
    nameNote: ReactNode;
    aboutLabel: string;
    aboutHref: string;
    nameLabel: string;
    nameHref: string;
    tutorialLabel: string;
  };
  security: { eyebrow: string; title: string; body: string };
  features: Record<FeatureKey, FeatureCopy>;
  benchmarks: {
    eyebrow: string;
    title: string;
    body: string;
    /** Omit to use the chart component's built-in English copy. */
    charts?: BenchmarkChartsCopy;
  };
  mcp: {
    eyebrow: string;
    title: string;
    intro: ReactNode;
    serverTitle: string;
    serverBody: ReactNode;
    serverCta: string;
    serverSnippet: string;
    docsTitle: string;
    docsBody: string;
    endpointTitle: string;
    endpointBody: string;
    tools: Record<McpToolName, string>;
    configLabel: string;
    stdioNote: ReactNode;
  };
  contracts: {
    eyebrow: string;
    title: string;
    body: string;
    /** Omit to use the visual's built-in English copy. */
    flow?: ContractFlowCopy;
    helloWorld: string;
  };
  scalar: {
    title: string;
    body: ReactNode;
    footer: string;
    guideCta: string;
  };
  comparison: {
    eyebrow: string;
    title: string;
    body: string;
    youWant: string;
    todayPrefix: string;
    todaysBest: string;
    daloyGives: string;
    rows: ReadonlyArray<{ want: string; best: string; give: string }>;
  };
  cta: {
    title: string;
    body: string;
    install: string;
    tutorial: string;
    source: string;
  };
  support: {
    eyebrow: string;
    title: string;
    body: string;
    coffee: string;
    blog: string;
  };
};
