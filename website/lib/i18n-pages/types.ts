import type { ReactNode } from "react";

/** `<title>`, meta description and keywords of one translated page. */
export type PageMeta = {
  title: string;
  /**
   * Meta description. Latin-script locales aim for 140–160 characters; CJK
   * locales for roughly 50–90, which fills the same snippet width.
   */
  description: string;
  keywords: string[];
};

/** One inline link inside translated prose. */
export type InlineLink = { href: string; label: string };

/**
 * Every string the translated marketing pages and the translated docs index
 * need, for one locale. `app/[locale]/**` renders from this, so adding a
 * locale is one object of this type plus its home and docs content.
 *
 * Mirrors the English sources: `HOME_TITLE` / `HOME_DESCRIPTION` in
 * `lib/seo.ts`, the `*_PARAGRAPHS` in `lib/trust-content.ts`, and the English
 * `app/about*`, `app/contact` and `app/privacy` pages. Keep them in step.
 */
export type TranslatedPagesCopy = {
  /** Separator for inline lists ("a, b" / "a、b"). */
  listSeparator: string;
  /** Sentence-final punctuation. */
  end: string;
  home: PageMeta & {
    /**
     * Short `<title>` (`· DaloyJS` is appended) that fits a search result,
     * about 60 characters with CJK counted double. `title` stays the full
     * tagline for the OG card and JSON-LD.
     */
    documentTitle: string;
    /**
     * Footer tagline of this locale's OG card, or `null` to reuse the English
     * card (the OG renderer ships Latin fonts only).
     */
    ogFooter: string | null;
  };
  about: PageMeta & {
    heading: string;
    paragraphs: readonly string[];
    more: { label: string; links: readonly InlineLink[]; lastSeparator: string };
  };
  aboutTheName: PageMeta & { heading: string; body: ReactNode };
  contact: PageMeta & {
    heading: string;
    paragraphs: readonly string[];
    directLabel: string;
    issues: string;
    advisory: string;
    privacyLabel: string;
  };
  privacy: PageMeta & {
    heading: string;
    updated: string;
    appliesTo: string;
    courtesy: { before: string; link: string; after: string };
    paragraphs: readonly string[];
    questions: string;
    otherContact: string;
  };
  docsIndex: PageMeta & { heading: string; intro: string };
};
