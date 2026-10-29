import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HTML_LANG,
  isTranslatedLocale,
  languageAlternates,
  localeFromPathname,
  localeHome,
  localizedPath,
  parseLocaleHeader,
  SITE_LOCALES,
  switchLocaleHref,
  TRANSLATED_LOCALES,
  TRANSLATED_PATHS,
} from "../../lib/i18n";
import { PAGES_COPY } from "../../lib/i18n-pages";
import {
  ABOUT_PARAGRAPHS,
  CONTACT_PARAGRAPHS,
  PRIVACY_PARAGRAPHS,
} from "../../lib/trust-content";
import { buildMetadata } from "../../lib/seo";
import { localizedSitePages } from "../../lib/sitemap-entries";

const MARKETING_PATHS = TRANSLATED_PATHS.filter((p) => !p.startsWith("/docs"));

test("each translated prefix and the paths under it map to its locale", () => {
  assert.equal(localeFromPathname("/es"), "es");
  assert.equal(localeFromPathname("/es/about"), "es");
  assert.equal(localeFromPathname("/zh"), "zh");
  assert.equal(localeFromPathname("/zh/docs/installation"), "zh");
  assert.equal(localeFromPathname("/zh/"), "zh");
});

test("look-alike prefixes and other paths stay English", () => {
  for (const path of ["/", "/esm", "/es-ES", "/zhx", "/zh-CN", "/fra", "/fr-FR", "/docs/es", "/docs/zh", "/docs/fr", "/blog"]) {
    assert.equal(localeFromPathname(path), "en", path);
  }
});

test("locale header only accepts exact translated locale ids", () => {
  assert.equal(parseLocaleHeader("es"), "es");
  assert.equal(parseLocaleHeader("zh"), "zh");
  assert.equal(parseLocaleHeader("fr"), "fr");
  for (const value of [null, "", "en", "ES", "es-ES", "zh-CN", "FR", "fr-FR", "de", "es ", "constructor", "__proto__"]) {
    assert.equal(parseLocaleHeader(value), "en", String(value));
  }
  assert.equal(isTranslatedLocale("toString"), false);
});

test("translated pages map between every pair of locales", () => {
  for (const path of TRANSLATED_PATHS) {
    for (const from of SITE_LOCALES) {
      for (const to of SITE_LOCALES) {
        assert.equal(switchLocaleHref(localizedPath(path, from), to), localizedPath(path, to), `${path} ${from}->${to}`);
      }
    }
  }
  assert.equal(localizedPath("/", "zh"), "/zh");
  assert.equal(switchLocaleHref("/zh/about/", "es"), "/es/about");
});

test("untranslated pages fall back to the target locale's home page", () => {
  assert.equal(switchLocaleHref("/docs/routing", "zh"), "/zh");
  assert.equal(switchLocaleHref("/blog/some-post", "es"), "/es");
  assert.equal(switchLocaleHref("/zh/docs/routing", "es"), "/es");
  assert.equal(switchLocaleHref("/es/nope", "en"), "/");
  assert.equal(switchLocaleHref("/docs", "en"), "/docs");
  assert.equal(localeHome("en"), "/");
});

test("hreflang alternates list every locale with English as x-default", () => {
  assert.deepEqual(languageAlternates("/about"), {
    en: "/about",
    "es-ES": "/es/about",
    "zh-CN": "/zh/about",
    "fr-FR": "/fr/about",
    "x-default": "/about",
  });
  assert.equal(HTML_LANG.zh, "zh-CN");
});

test("buildMetadata emits hreflang and every other og:locale for translated pages", () => {
  const meta = buildMetadata({
    title: "关于",
    description: "x",
    path: "/zh/about",
    locale: "zh",
    translatedPath: "/about",
  });
  assert.equal(meta.alternates?.canonical, "/zh/about");
  assert.deepEqual(meta.alternates?.languages, languageAlternates("/about"));
  const og = meta.openGraph as { locale?: string; alternateLocale?: string[] };
  assert.equal(og.locale, "zh_CN");
  assert.deepEqual(og.alternateLocale, ["en_US", "es_ES", "fr_FR"]);
});

test("buildMetadata stays English with no alternates by default", () => {
  const meta = buildMetadata({ title: "Routing", description: "x", path: "/docs/routing" });
  assert.equal(meta.alternates?.languages, undefined);
  const og = meta.openGraph as { locale?: string; alternateLocale?: string[] };
  assert.equal(og.locale, "en_US");
  assert.equal(og.alternateLocale, undefined);
});

test("sitemap lists every translated marketing page with shared alternates", () => {
  const entries = localizedSitePages();
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  // Docs twins come from the docs tree (buildSitemapEntries), not SITE_PAGES.
  for (const path of MARKETING_PATHS) {
    const en = byPath.get(path);
    assert.ok(en, `missing ${path}`);
    assert.deepEqual(en.languages, languageAlternates(path));
    for (const locale of TRANSLATED_LOCALES) {
      const translated = byPath.get(localizedPath(path, locale));
      assert.ok(translated, `missing ${localizedPath(path, locale)}`);
      assert.deepEqual(translated.languages, en.languages);
    }
  }
  // Docs indexes have no English twin; no docs page is hand-listed here.
  for (const locale of TRANSLATED_LOCALES) {
    assert.equal(byPath.get(`/${locale}/docs`)?.languages, undefined);
    assert.ok(byPath.has(`/${locale}/docs`), `missing /${locale}/docs`);
    assert.ok(!entries.some((entry) => entry.path.startsWith(`/${locale}/docs/`)));
  }
  assert.equal(byPath.get("/blog")?.languages, undefined);
});

test("translated trust pages keep the English paragraph structure and facts", () => {
  const dates = { es: "29 de octubre de 2026", zh: "2026 年 10 月 29 日", fr: "29 octobre 2026" } as const;
  for (const locale of TRANSLATED_LOCALES) {
    const pages = PAGES_COPY[locale];
    assert.equal(pages.about.paragraphs.length, ABOUT_PARAGRAPHS.length, locale);
    assert.equal(pages.contact.paragraphs.length, CONTACT_PARAGRAPHS.length, locale);
    assert.equal(pages.privacy.paragraphs.length, PRIVACY_PARAGRAPHS.length, locale);
    const privacy = pages.privacy.paragraphs.join(" ");
    for (const fact of ["G-DSBFBZT7RQ", "Vercel", "daloyjs@gmail.com", "/mcp", dates[locale]]) {
      assert.ok(privacy.includes(fact), `${locale}: ${fact}`);
    }
    // In-page links stay inside the locale.
    for (const link of pages.about.more.links) {
      assert.equal(localeFromPathname(link.href), locale, link.href);
    }
  }
});

/** Every string inside a value, skipping React elements. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === "object" && !("$$typeof" in value)) {
    Object.values(value).forEach((item) => strings(item, out));
  }
  return out;
}

test("translated page copy uses no em dashes and sized meta descriptions", () => {
  const range = { es: [140, 160], zh: [40, 90], fr: [140, 160] } as const;
  for (const locale of TRANSLATED_LOCALES) {
    const pages = PAGES_COPY[locale];
    for (const text of strings(pages)) {
      assert.ok(!text.includes("—"), `${locale}: ${text.slice(0, 40)}`);
    }
    for (const key of ["home", "about", "aboutTheName", "contact", "privacy", "docsIndex"] as const) {
      const len = pages[key].description.length;
      const [min, max] = range[locale];
      assert.ok(len >= min && len <= max, `${locale}.${key}.description is ${len} chars`);
    }
  }
});

test("every translated home copy mirrors the English structure", async () => {
  const { HOME_COPY_EN } = await import("../../components/home/home-copy-en");
  const { HOME_COPIES } = await import("../../components/home/home-copies");
  for (const locale of TRANSLATED_LOCALES) {
    const copy = HOME_COPIES[locale];
    assert.equal(copy.locale, locale);
    assert.equal(copy.hero.facts.length, HOME_COPY_EN.hero.facts.length, locale);
    assert.equal(copy.comparison.rows.length, HOME_COPY_EN.comparison.rows.length, locale);
    for (const key of Object.keys(HOME_COPY_EN.features) as Array<keyof typeof HOME_COPY_EN.features>) {
      assert.equal(copy.features[key].badges?.length, HOME_COPY_EN.features[key].badges?.length, `${locale}.${key}`);
    }
    assert.equal(copy.benchmarks.charts?.notes.length, 5, locale);
    // In-locale links stay inside the locale; the docs note is present.
    assert.equal(localeFromPathname(copy.hero.aboutHref), locale);
    assert.equal(localeFromPathname(copy.hero.nameHref), locale);
    assert.equal(localeFromPathname(copy.links.gettingStarted), locale);
    assert.ok(copy.hero.contentLanguageNote);
    for (const text of strings(copy)) {
      assert.ok(!text.includes("—"), `${locale}: ${text.slice(0, 40)}`);
    }
  }
});

test("home pages advertise the promoted locales; French is header-menu only", async () => {
  const { LANGUAGE_NOTICES } = await import("../../components/home/language-notices");
  const { PROMOTED_LOCALES } = await import("../../lib/i18n");
  assert.deepEqual(Object.keys(LANGUAGE_NOTICES).sort(), [...PROMOTED_LOCALES].sort());
  assert.ok(!(PROMOTED_LOCALES as readonly string[]).includes("fr"), "no French hero pill or footer link");
  for (const notice of Object.values(LANGUAGE_NOTICES)) {
    assert.ok(notice.badge && notice.text && notice.cta);
  }
});

test("the header language menu offers every locale, French included", async () => {
  const { LOCALE_NATIVE_NAME } = await import("../../lib/i18n");
  assert.deepEqual(Object.keys(LOCALE_NATIVE_NAME).sort(), [...SITE_LOCALES].sort());
  assert.equal(LOCALE_NATIVE_NAME.fr, "Français");
  // Every page maps to its French counterpart when one exists.
  assert.equal(switchLocaleHref("/about", "fr"), "/fr/about");
  assert.equal(switchLocaleHref("/zh/docs/installation", "fr"), "/fr/docs/installation");
  assert.equal(switchLocaleHref("/docs/routing", "fr"), "/fr");
});

test("translated docs pages advertise their markdown sibling like English docs", async () => {
  const { isTranslatedDocsPath } = await import("../../lib/i18n");
  assert.equal(isTranslatedDocsPath("/zh/docs/installation"), true);
  assert.equal(isTranslatedDocsPath("/es/docs/tutorials/bookstore"), true);
  assert.equal(isTranslatedDocsPath("/zh/docs"), false);
  assert.equal(isTranslatedDocsPath("/docs/installation"), false);
  assert.equal(isTranslatedDocsPath("/zh/about"), false);

  const meta = buildMetadata({ title: "安装", description: "x", path: "/zh/docs/installation", locale: "zh" });
  assert.deepEqual(meta.alternates?.types, { "text/markdown": "/zh/docs/installation.md" });
  const marketing = buildMetadata({ title: "关于", description: "x", path: "/zh/about", locale: "zh" });
  assert.equal(marketing.alternates?.types, undefined);
});

test("imageAlt overrides the OG alt text; the title is the default", () => {
  const og = (meta: ReturnType<typeof buildMetadata>) =>
    (meta.openGraph as { images: Array<{ alt: string }> }).images[0]!.alt;
  assert.equal(og(buildMetadata({ title: "安装", description: "x", path: "/zh/docs/installation", imageAlt: "Installation · DaloyJS" })), "Installation · DaloyJS");
  assert.equal(og(buildMetadata({ title: "Routing", description: "x", path: "/docs/routing" })), "Routing · DaloyJS");
});

test("shared UI strings exist for every locale", async () => {
  const { UI_STRINGS } = await import("../../components/site-locale");
  for (const locale of SITE_LOCALES) {
    for (const value of Object.values(UI_STRINGS[locale])) {
      assert.ok(value.length > 0, locale);
    }
  }
  assert.equal(UI_STRINGS.zh.copy, "复制");
});

test("a translated 404 path turns into search words without the locale segment", async () => {
  const { queryFromPath } = await import("../../components/not-found-suggestions");
  assert.equal(queryFromPath("/zh/docs/rate-limits/redis"), "rate limits redis");
  assert.equal(queryFromPath("/es/docs/routing"), "routing");
  // A word that merely equals a locale id later in the path is kept.
  assert.equal(queryFromPath("/docs/guides/es"), "guides es");
});
