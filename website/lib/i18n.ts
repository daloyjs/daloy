/**
 * Site locales for daloyjs.dev.
 *
 * English is the default and lives at the root. Castilian Spanish (`es-ES`)
 * lives under `/es` and covers the pages listed in {@link TRANSLATED_PATHS}:
 * the marketing pages plus the docs on-ramp (`content/es/docs`). Every other
 * docs page and the blog stay English-only.
 *
 * Crossing locales is always a full document load (plain `<a>`, never
 * `next/link`): the root layout renders `<html lang>`, the header and the
 * footer once per document from the `x-site-locale` header that `proxy.ts`
 * sets, so a client-side navigation into the other locale would keep the
 * previous language's chrome.
 */

/** A locale the site renders. */
export type SiteLocale = "en" | "es";

/** Request header `proxy.ts` sets (always overwriting client input). */
export const LOCALE_HEADER = "x-site-locale";

/** Path prefix of the Spanish section. */
export const SPANISH_ROOT = "/es";

/** BCP 47 tag for `<html lang>` and `hreflang`. */
export const HTML_LANG: Record<SiteLocale, string> = {
  en: "en",
  es: "es-ES",
};

/** OpenGraph `og:locale` value. */
export const OG_LOCALE: Record<SiteLocale, string> = {
  en: "en_US",
  es: "es_ES",
};

/**
 * English paths that have a Spanish counterpart at `/es<path>`. A docs entry
 * here must have a matching `content/es/docs` file (enforced by
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

/** An English path with a Spanish translation. */
export type TranslatedPath = (typeof TRANSLATED_PATHS)[number];

const TRANSLATED = new Set<string>(TRANSLATED_PATHS);

/**
 * Whether an English path has a Spanish translation.
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
 * @param pathname - Request pathname, e.g. `/es/about`.
 * @returns `"es"` for `/es` and anything under `/es/`, otherwise `"en"`.
 *   `/esm` or `/es-foo` are English: only the exact segment counts.
 */
export function localeFromPathname(pathname: string): SiteLocale {
  return pathname === SPANISH_ROOT || pathname.startsWith(`${SPANISH_ROOT}/`)
    ? "es"
    : "en";
}

/**
 * Parse the {@link LOCALE_HEADER} value. Anything unexpected is English, so a
 * missing header (prefetch requests skip the proxy) renders the default.
 *
 * @param value - Raw header value.
 * @returns The locale.
 */
export function parseLocaleHeader(value: string | null): SiteLocale {
  return value === "es" ? "es" : "en";
}

/**
 * Spanish URL for a translated English path.
 *
 * @param path - English path from {@link TRANSLATED_PATHS}.
 * @returns `/es` for `/`, else `/es<path>`.
 */
export function spanishPath(path: TranslatedPath): string {
  return path === "/" ? SPANISH_ROOT : `${SPANISH_ROOT}${path}`;
}

/**
 * Where the language switcher should send a reader who is on `pathname` and
 * wants `target`. A page with a counterpart maps to it; anything else (docs,
 * blog) falls back to the target locale's home page.
 *
 * @param pathname - Current pathname.
 * @param target - Locale to switch to.
 * @returns A site-absolute path.
 */
export function switchLocaleHref(pathname: string, target: SiteLocale): string {
  const path = stripTrailingSlash(pathname);
  if (localeFromPathname(path) === "es") {
    if (target === "es") return path;
    const english = path.slice(SPANISH_ROOT.length) || "/";
    return TRANSLATED.has(english) ? english : "/";
  }
  if (target === "en") return path;
  return TRANSLATED.has(path) ? spanishPath(path as TranslatedPath) : SPANISH_ROOT;
}

/**
 * `hreflang` alternates for a translated page, for `metadata.alternates
 * .languages` and the sitemap. `x-default` points at English.
 *
 * @param path - English path from {@link TRANSLATED_PATHS}.
 * @returns Map of language tag to site-absolute path.
 */
export function languageAlternates(path: TranslatedPath): Record<string, string> {
  return {
    [HTML_LANG.en]: path,
    [HTML_LANG.es]: spanishPath(path),
    "x-default": path,
  };
}
