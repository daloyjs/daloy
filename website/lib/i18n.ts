/**
 * Site locales for daloyjs.dev.
 *
 * English is the default and lives at the root. Each translated locale lives
 * under its own prefix ({@link LOCALE_PREFIX}: `/es` for Castilian Spanish,
 * `/zh` for Simplified Chinese, `/fr` for French, `/pt` for Brazilian
 * Portuguese, `/ar` for Modern Standard Arabic, `/ru` for Russian, `/de` for
 * standard German) and covers
 * exactly the pages listed in
 * {@link TRANSLATED_PATHS}: the marketing pages plus the docs on-ramp
 * (`content/<locale>/docs`). Every other docs page and the blog stay
 * English-only.
 *
 * Crossing locales is always a full document load (plain `<a>`, never
 * `next/link`): the root layout renders `<html lang>`, the header and the
 * footer once per document from the `x-site-locale` header that `proxy.ts`
 * sets, so a client-side navigation into another locale would keep the
 * previous language's chrome.
 */

/** A locale the site renders. */
export type SiteLocale = "en" | "es" | "zh" | "fr" | "pt" | "ar" | "ru" | "de" | "ja";

/** A locale other than the English default. */
export type TranslatedLocale = Exclude<SiteLocale, "en">;

/** Every locale, English first (the order of the language switcher). */
export const SITE_LOCALES: readonly SiteLocale[] = ["en", "es", "zh", "fr", "pt", "ar", "ru", "de", "ja"];

/** Every translated locale. */
export const TRANSLATED_LOCALES: readonly TranslatedLocale[] = ["es", "zh", "fr", "pt", "ar", "ru", "de", "ja"];

/**
 * Locales advertised outside the header language menu: the home-page hero
 * pills and the footer language links. French, Portuguese, Arabic, Russian,
 * German and Japanese are deliberately absent: they are offered only through
 * the header menu.
 */
export const PROMOTED_LOCALES: readonly PromotedLocale[] = ["en", "es", "zh"];

/** A locale listed in {@link PROMOTED_LOCALES}. */
export type PromotedLocale = "en" | "es" | "zh";

/** Request header `proxy.ts` sets (always overwriting client input). */
export const LOCALE_HEADER = "x-site-locale";

/** Path prefix of each translated locale. */
export const LOCALE_PREFIX: Record<TranslatedLocale, string> = {
  es: "/es",
  zh: "/zh",
  fr: "/fr",
  pt: "/pt",
  ar: "/ar",
  ru: "/ru",
  de: "/de",
  ja: "/ja",
};

/** BCP 47 tag for `<html lang>` and `hreflang`. */
export const HTML_LANG: Record<SiteLocale, string> = {
  en: "en",
  es: "es-ES",
  zh: "zh-CN",
  fr: "fr-FR",
  pt: "pt-BR",
  ar: "ar",
  ru: "ru",
  de: "de",
  ja: "ja",
};

/** OpenGraph `og:locale` value. */
export const OG_LOCALE: Record<SiteLocale, string> = {
  en: "en_US",
  es: "es_ES",
  zh: "zh_CN",
  fr: "fr_FR",
  pt: "pt_BR",
  ar: "ar_AR",
  ru: "ru_RU",
  de: "de_DE",
  ja: "ja_JP",
};

/** Each locale's name, written in that language (for the switcher). */
export const LOCALE_NATIVE_NAME: Record<SiteLocale, string> = {
  en: "English",
  es: "Español",
  zh: "简体中文",
  fr: "Français",
  pt: "Português",
  ar: "العربية",
  ru: "Русский",
  de: "Deutsch",
  ja: "日本語",
};

/**
 * Text direction per locale, for `<html dir>`. Arabic is the only
 * right-to-left locale; shared components use logical CSS (`ms-*`,
 * `text-start`, `end-0`) and the `rtl:` variant so they mirror correctly.
 */
export const HTML_DIR: Record<SiteLocale, "ltr" | "rtl"> = {
  en: "ltr",
  es: "ltr",
  zh: "ltr",
  fr: "ltr",
  pt: "ltr",
  ar: "rtl",
  ru: "ltr",
  de: "ltr",
  ja: "ltr",
};

/**
 * Whether a locale is written right to left.
 *
 * @param locale - Site locale.
 * @returns `true` for Arabic.
 */
export function isRtl(locale: SiteLocale): boolean {
  return HTML_DIR[locale] === "rtl";
}

/**
 * Whether social cards for a locale reuse the English card. The OG renderer
 * ships Latin fonts only, so a non-Latin script (Chinese, Japanese, Arabic,
 * Cyrillic) would render as empty boxes.
 */
export const OG_USES_ENGLISH_CARD: Record<SiteLocale, boolean> = {
  en: false,
  es: false,
  zh: true,
  fr: false,
  pt: false,
  ar: true,
  ru: true,
  de: false,
  ja: true,
};

/**
 * English paths that have a counterpart at `<prefix><path>` in every
 * translated locale. A docs entry here must have a matching
 * `content/<locale>/docs` file for each locale (enforced by
 * tests/lib/i18n-docs.test.ts).
 */
export const TRANSLATED_PATHS = [
  "/",
  "/about",
  "/about-the-name",
  "/contact",
  "/privacy",
  "/docs/getting-started",
  "/docs/installation",
  "/docs/tutorials/bookstore",
] as const;

/** An English path with translations. */
export type TranslatedPath = (typeof TRANSLATED_PATHS)[number];

const TRANSLATED = new Set<string>(TRANSLATED_PATHS);

/**
 * Whether a value is a translated locale id (e.g. a `[locale]` route param).
 *
 * @param value - Candidate locale id.
 * @returns `true` (and narrows the type) for a translated locale id.
 */
export function isTranslatedLocale(value: string): value is TranslatedLocale {
  return (TRANSLATED_LOCALES as readonly string[]).includes(value);
}

/**
 * Whether an English path has translations.
 *
 * @param path - Site path, e.g. `/docs/installation`.
 * @returns `true` (and narrows the type) for a {@link TranslatedPath}.
 */
export function isTranslatedPath(path: string): path is TranslatedPath {
  return TRANSLATED.has(path);
}

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

/**
 * The locale a pathname belongs to.
 *
 * @param pathname - Request pathname, e.g. `/zh/about`.
 * @returns The translated locale whose prefix is the whole first segment,
 *   otherwise `"en"`. `/esm`, `/es-foo` or `/zhx` are English.
 */
export function localeFromPathname(pathname: string): SiteLocale {
  for (const locale of TRANSLATED_LOCALES) {
    const prefix = LOCALE_PREFIX[locale];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return locale;
  }
  return "en";
}

/**
 * Parse the {@link LOCALE_HEADER} value. Anything unexpected is English, so a
 * missing header (prefetch requests skip the proxy) renders the default.
 *
 * @param value - Raw header value.
 * @returns The locale.
 */
export function parseLocaleHeader(value: string | null): SiteLocale {
  return value !== null && isTranslatedLocale(value) ? value : "en";
}

/**
 * URL of a translated English path in `locale`.
 *
 * @param path - English path from {@link TRANSLATED_PATHS}.
 * @param locale - Target locale.
 * @returns The path itself for English, `/<prefix>` for `/`, else `<prefix><path>`.
 */
export function localizedPath(path: TranslatedPath, locale: SiteLocale): string {
  if (locale === "en") return path;
  const prefix = LOCALE_PREFIX[locale];
  return path === "/" ? prefix : `${prefix}${path}`;
}

/**
 * Home page of a locale.
 *
 * @param locale - Target locale.
 * @returns `/` or the locale prefix.
 */
export function localeHome(locale: SiteLocale): string {
  return localizedPath("/", locale);
}

/**
 * Where the language switcher should send a reader who is on `pathname` and
 * wants `target`. A page with a counterpart maps to it; anything else (most
 * docs, the blog, an unknown translated URL) falls back to the target
 * locale's home page.
 *
 * @param pathname - Current pathname.
 * @param target - Locale to switch to.
 * @returns A site-absolute path.
 */
export function switchLocaleHref(pathname: string, target: SiteLocale): string {
  const path = stripTrailingSlash(pathname);
  const current = localeFromPathname(path);
  if (current === target) return path;
  const english =
    current === "en" ? path : path.slice(LOCALE_PREFIX[current].length) || "/";
  return isTranslatedPath(english) ? localizedPath(english, target) : localeHome(target);
}

/**
 * `hreflang` alternates for a translated page, for `metadata.alternates
 * .languages` and the sitemap. `x-default` points at English.
 *
 * @param path - English path from {@link TRANSLATED_PATHS}.
 * @returns Map of language tag to site-absolute path.
 */
export function languageAlternates(path: TranslatedPath): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of SITE_LOCALES) {
    languages[HTML_LANG[locale]] = localizedPath(path, locale);
  }
  languages["x-default"] = path;
  return languages;
}

/**
 * Index page of a translated locale's docs, e.g. `/zh/docs`.
 *
 * @param locale - Translated locale.
 * @returns The docs index path.
 */
export function translatedDocsIndex(locale: TranslatedLocale): string {
  return `${LOCALE_PREFIX[locale]}/docs`;
}

/**
 * Whether a path is a page inside a translated docs tree (`/es/docs/...`,
 * `/zh/docs/...`), excluding the docs index itself.
 *
 * @param path - Site path.
 * @returns `true` for a translated docs page route.
 */
export function isTranslatedDocsPath(path: string): boolean {
  const locale = localeFromPathname(path);
  return locale !== "en" && path.startsWith(`${translatedDocsIndex(locale)}/`);
}
