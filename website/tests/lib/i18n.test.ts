import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HTML_LANG,
  isTranslatedLocale,
  languageAlternates,
  localeFromPathname,
  localeHome,
  localizedPath,
  OG_USES_ENGLISH_CARD,
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
  for (const path of ["/", "/esm", "/es-ES", "/zhx", "/zh-CN", "/fra", "/fr-FR", "/ptx", "/pt-BR", "/ara", "/ar-SA", "/rus", "/ru-RU", "/deu", "/de-DE", "/jap", "/ja-JP", "/jp", "/docs/es", "/docs/zh", "/docs/fr", "/docs/pt", "/docs/ar", "/docs/ru", "/docs/de", "/docs/ja", "/blog"]) {
    assert.equal(localeFromPathname(path), "en", path);
  }
});

test("locale header only accepts exact translated locale ids", () => {
  assert.equal(parseLocaleHeader("es"), "es");
  assert.equal(parseLocaleHeader("zh"), "zh");
  assert.equal(parseLocaleHeader("fr"), "fr");
  assert.equal(parseLocaleHeader("pt"), "pt");
  assert.equal(parseLocaleHeader("ar"), "ar");
  assert.equal(parseLocaleHeader("ru"), "ru");
  assert.equal(parseLocaleHeader("de"), "de");
  assert.equal(parseLocaleHeader("ja"), "ja");
  for (const value of [null, "", "en", "ES", "es-ES", "zh-CN", "FR", "fr-FR", "PT", "pt-BR", "pt-PT", "AR", "ar-SA", "RU", "ru-RU", "DE", "de-DE", "JA", "ja-JP", "jp", "it", "es ", "constructor", "__proto__"]) {
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
    "pt-BR": "/pt/about",
    ar: "/ar/about",
    ru: "/ru/about",
    de: "/de/about",
    ja: "/ja/about",
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
  assert.deepEqual(og.alternateLocale, ["en_US", "es_ES", "fr_FR", "pt_BR", "ar_AR", "ru_RU", "de_DE", "ja_JP"]);
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
  const dates = { es: "29 de octubre de 2026", zh: "2026 年 10 月 29 日", fr: "29 octobre 2026", pt: "29 de outubro de 2026", ar: "29 أكتوبر 2026", ru: "29 октября 2026", de: "29. Oktober 2026", ja: "2026年10月29日" } as const;
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
  const range = { es: [140, 160], zh: [40, 90], fr: [140, 160], pt: [140, 160], ar: [100, 160], ru: [140, 160], de: [140, 160], ja: [40, 90] } as const;
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

test("home pages advertise the promoted locales; French, Portuguese, Arabic, Russian, German and Japanese are header-menu only", async () => {
  const { LANGUAGE_NOTICES } = await import("../../components/home/language-notices");
  const { PROMOTED_LOCALES } = await import("../../lib/i18n");
  assert.deepEqual(Object.keys(LANGUAGE_NOTICES).sort(), [...PROMOTED_LOCALES].sort());
  for (const locale of ["fr", "pt", "ar", "ru", "de", "ja"]) {
    assert.ok(!(PROMOTED_LOCALES as readonly string[]).includes(locale), `no ${locale} hero pill or footer link`);
  }
  for (const notice of Object.values(LANGUAGE_NOTICES)) {
    assert.ok(notice.badge && notice.text && notice.cta);
  }
});

test("the header language menu offers every locale, French and Portuguese included", async () => {
  const { LOCALE_NATIVE_NAME } = await import("../../lib/i18n");
  assert.deepEqual(Object.keys(LOCALE_NATIVE_NAME).sort(), [...SITE_LOCALES].sort());
  assert.equal(LOCALE_NATIVE_NAME.fr, "Français");
  assert.equal(LOCALE_NATIVE_NAME.pt, "Português");
  assert.equal(LOCALE_NATIVE_NAME.ar, "العربية");
  assert.equal(LOCALE_NATIVE_NAME.ru, "Русский");
  assert.equal(LOCALE_NATIVE_NAME.de, "Deutsch");
  assert.equal(LOCALE_NATIVE_NAME.ja, "日本語");
  assert.equal(switchLocaleHref("/ja/docs/getting-started", "zh"), "/zh/docs/getting-started");
  assert.equal(switchLocaleHref("/ja/contact", "en"), "/contact");
  assert.equal(switchLocaleHref("/docs/routing", "ja"), "/ja");
  assert.equal(switchLocaleHref("/de/docs/installation", "fr"), "/fr/docs/installation");
  assert.equal(switchLocaleHref("/ru/privacy", "ar"), "/ar/privacy");
  assert.equal(switchLocaleHref("/ar/about", "en"), "/about");
  assert.equal(switchLocaleHref("/docs/installation", "ar"), "/ar/docs/installation");
  assert.equal(switchLocaleHref("/fr/privacy", "pt"), "/pt/privacy");
  assert.equal(switchLocaleHref("/pt/docs/tutorials/bookstore", "en"), "/docs/tutorials/bookstore");
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

test("Arabic is the only right-to-left locale", async () => {
  const { HTML_DIR, isRtl } = await import("../../lib/i18n");
  for (const locale of SITE_LOCALES) {
    assert.equal(HTML_DIR[locale], locale === "ar" ? "rtl" : "ltr", locale);
    assert.equal(isRtl(locale), locale === "ar");
  }
});

test("shared chrome uses logical direction utilities so RTL pages mirror", async () => {
  const { readFileSync } = await import("node:fs");
  // Physical left/right utilities do not flip under dir="rtl". The shared
  // chrome every locale renders must use ms-/me-/ps-/pe-/start-/end-/
  // text-start/text-end (or an explicit rtl: variant) instead.
  const files = [
    "components/site-header.tsx",
    "components/language-switcher.tsx",
    "components/site-footer.tsx",
    "components/home/home-page.tsx",
    "components/translated-docs-nav.tsx",
    "components/translated-docs-nav-list.tsx",
    "components/translated-docs-search.tsx",
    "components/cards.tsx",
    "components/reading-progress.tsx",
    "app/[locale]/docs/layout.tsx",
    "app/not-found.tsx",
  ];
  // Matches bare and variant-prefixed classes (sm:text-left, md:pl-4) but
  // not prose such as "left-to-right" (position utilities need a value).
  const physical =
    /(?<![\w-])(?:-?m[lr]-|p[lr]-|(?:left|right)-(?:\d|\[|px\b|full\b|auto\b)|text-(?:left|right)\b|rounded-[lr](?:-|\b)|border-[lr](?:-|\b))/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const hits = [...source.matchAll(physical)].map((m) => m[0]);
    assert.deepEqual(hits, [], `${file} uses physical direction utilities`);
  }
});

test("right-to-left pages keep code left to right", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\[dir="rtl"\] code,[\s\S]*?\[dir="rtl"\] pre \{[\s\S]*?direction: ltr;/);
  assert.match(css, /html:lang\(ar\) body/);
});

test("text in another language carries its own direction", async () => {
  const { readFileSync } = await import("node:fs");
  // On an RTL page, an English pill without dir="ltr" renders its final
  // period at the start ("…English."). Every lang= switch must set dir too.
  for (const file of ["components/home/home-page.tsx", "components/language-switcher.tsx", "components/site-footer.tsx"]) {
    const source = readFileSync(file, "utf8");
    const langs = source.match(/\blang=\{HTML_LANG\[(\w+)\]\}/g) ?? [];
    for (const attr of langs) {
      const key = attr.match(/\[(\w+)\]/)![1];
      assert.ok(source.includes(`dir={HTML_DIR[${key}]}`), `${file}: ${attr} needs a matching dir`);
    }
  }
});

test("no translated copy uses an em dash, including the JSX-rich fields", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement, Fragment } = await import("react");
  const { HOME_COPIES } = await import("../../components/home/home-copies");
  // Plain-string checks skip React elements, so render every JSX field too.
  const texts = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach((item) => texts(item, out));
    else if (value && typeof value === "object") {
      if ("$$typeof" in value) out.push(renderToStaticMarkup(createElement(Fragment, null, value as never)));
      else Object.values(value).forEach((item) => texts(item, out));
    }
    return out;
  };
  for (const locale of TRANSLATED_LOCALES) {
    for (const text of texts([HOME_COPIES[locale], PAGES_COPY[locale]])) {
      assert.ok(!text.includes("\u2014"), `${locale}: ${text.slice(0, 60)}`);
    }
  }
});

test("Russian pages load Inter's Cyrillic subset without preloading it", async () => {
  const { readFileSync } = await import("node:fs");
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /subsets: \["cyrillic"\][\s\S]*?preload: false/);
  assert.match(readFileSync("app/globals.css", "utf8"), /html:lang\(ru\) body \{\s*font-family: var\(--font-sans-cyrillic\)/);
});

test("Japanese pages name Japanese fonts so kanji never fall back to Chinese glyph forms", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("app/globals.css", "utf8");
  const rule = /html:lang\(ja\) body \{\s*font-family: ([^;]+);/.exec(css)?.[1];
  assert.ok(rule, "html:lang(ja) font rule");
  assert.match(rule, /"Hiragino Sans"/);
  assert.match(rule, /"Noto Sans JP"/);
  // No Chinese face may come before the generic fallback.
  assert.doesNotMatch(rule, /PingFang|YaHei|Noto Sans SC|Hiragino Sans GB/);
  assert.equal(HTML_LANG.ja, "ja");
  assert.equal(OG_USES_ENGLISH_CARD.ja, true, "the OG renderer has no Japanese glyphs");
});
