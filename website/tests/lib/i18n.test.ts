import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HTML_LANG,
  languageAlternates,
  localeFromPathname,
  parseLocaleHeader,
  spanishPath,
  switchLocaleHref,
  TRANSLATED_PATHS,
} from "../../lib/i18n";
import {
  ABOUT_PARAGRAPHS_ES,
  CONTACT_PARAGRAPHS_ES,
  HOME_DESCRIPTION_ES,
  PRIVACY_PARAGRAPHS_ES,
} from "../../lib/i18n-es";
import {
  ABOUT_PARAGRAPHS,
  CONTACT_PARAGRAPHS,
  PRIVACY_PARAGRAPHS,
} from "../../lib/trust-content";
import { buildMetadata } from "../../lib/seo";
import { localizedSitePages } from "../../lib/sitemap-entries";

test("/es and paths under /es/ are Spanish", () => {
  assert.equal(localeFromPathname("/es"), "es");
  assert.equal(localeFromPathname("/es/about"), "es");
  assert.equal(localeFromPathname("/es/"), "es");
});

test("look-alike prefixes and other paths stay English", () => {
  for (const path of ["/", "/esm", "/es-ES", "/escape", "/docs/es", "/blog"]) {
    assert.equal(localeFromPathname(path), "en", path);
  }
});

test("locale header only accepts the exact value es", () => {
  assert.equal(parseLocaleHeader("es"), "es");
  for (const value of [null, "", "en", "ES", "es-ES", "fr", "es "]) {
    assert.equal(parseLocaleHeader(value), "en", String(value));
  }
});

test("translated pages map to their counterpart in both directions", () => {
  for (const path of TRANSLATED_PATHS) {
    const es = spanishPath(path);
    assert.equal(switchLocaleHref(path, "es"), es);
    assert.equal(switchLocaleHref(es, "en"), path);
  }
  assert.equal(spanishPath("/"), "/es");
  assert.equal(switchLocaleHref("/es/about/", "en"), "/about");
});

test("untranslated pages fall back to the other locale's home page", () => {
  assert.equal(switchLocaleHref("/docs/routing", "es"), "/es");
  assert.equal(switchLocaleHref("/blog/some-post", "es"), "/es");
  // A Spanish URL with no English twin (a typo, a stale link) goes home.
  assert.equal(switchLocaleHref("/es/docs", "en"), "/");
  // Switching to the current locale is a no-op.
  assert.equal(switchLocaleHref("/docs", "en"), "/docs");
  assert.equal(switchLocaleHref("/es/about", "es"), "/es/about");
});

test("hreflang alternates pair both locales with English as x-default", () => {
  assert.deepEqual(languageAlternates("/about"), {
    en: "/about",
    "es-ES": "/es/about",
    "x-default": "/about",
  });
  assert.equal(HTML_LANG.es, "es-ES");
});

test("buildMetadata emits hreflang and og:locale for translated pages", () => {
  const meta = buildMetadata({
    title: "Acerca de",
    description: "x",
    path: "/es/about",
    locale: "es",
    translatedPath: "/about",
  });
  assert.equal(meta.alternates?.canonical, "/es/about");
  assert.deepEqual(meta.alternates?.languages, languageAlternates("/about"));
  const og = meta.openGraph as { locale?: string; alternateLocale?: string[] };
  assert.equal(og.locale, "es_ES");
  assert.deepEqual(og.alternateLocale, ["en_US"]);
});

test("buildMetadata stays English with no alternates by default", () => {
  const meta = buildMetadata({ title: "Routing", description: "x", path: "/docs/routing" });
  assert.equal(meta.alternates?.languages, undefined);
  const og = meta.openGraph as { locale?: string; alternateLocale?: string[] };
  assert.equal(og.locale, "en_US");
  assert.equal(og.alternateLocale, undefined);
});

test("sitemap lists every Spanish page with reciprocal alternates", () => {
  const entries = localizedSitePages();
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  // Docs twins come from the docs tree (buildSitemapEntries), not SITE_PAGES.
  for (const path of TRANSLATED_PATHS.filter((p) => !p.startsWith("/docs"))) {
    const en = byPath.get(path);
    const es = byPath.get(spanishPath(path));
    assert.ok(en, `missing ${path}`);
    assert.ok(es, `missing ${spanishPath(path)}`);
    assert.deepEqual(en.languages, languageAlternates(path));
    assert.deepEqual(es.languages, en.languages);
  }
  // The /es/docs index has no English twin, so no alternates; no docs page
  // is hand-listed here.
  assert.equal(byPath.get("/es/docs")?.languages, undefined);
  assert.ok(!entries.some((entry) => entry.path.startsWith("/es/docs/")));
  assert.equal(byPath.get("/blog")?.languages, undefined);
});

test("Spanish trust pages keep the English paragraph structure", () => {
  assert.equal(ABOUT_PARAGRAPHS_ES.length, ABOUT_PARAGRAPHS.length);
  assert.equal(CONTACT_PARAGRAPHS_ES.length, CONTACT_PARAGRAPHS.length);
  assert.equal(PRIVACY_PARAGRAPHS_ES.length, PRIVACY_PARAGRAPHS.length);
  // The privacy translation must keep the facts a reader relies on.
  const privacy = PRIVACY_PARAGRAPHS_ES.join(" ");
  for (const fact of ["G-DSBFBZT7RQ", "Vercel", "daloyjs@gmail.com", "21 de agosto de 2026"]) {
    assert.ok(privacy.includes(fact), fact);
  }
});

test("Spanish copy uses no em dashes and fits the meta description limit", () => {
  const all = [
    HOME_DESCRIPTION_ES,
    ...ABOUT_PARAGRAPHS_ES,
    ...CONTACT_PARAGRAPHS_ES,
    ...PRIVACY_PARAGRAPHS_ES,
  ];
  for (const text of all) {
    assert.ok(!text.includes("—"), text.slice(0, 40));
  }
  assert.ok(HOME_DESCRIPTION_ES.length >= 140 && HOME_DESCRIPTION_ES.length <= 160);
});

test("Spanish home copy mirrors the English structure", async () => {
  const { HOME_COPY_EN } = await import("../../components/home/home-copy-en");
  const { HOME_COPY_ES } = await import("../../components/home/home-copy-es");
  assert.equal(HOME_COPY_ES.locale, "es");
  assert.equal(HOME_COPY_ES.hero.facts.length, HOME_COPY_EN.hero.facts.length);
  assert.equal(HOME_COPY_ES.comparison.rows.length, HOME_COPY_EN.comparison.rows.length);
  for (const key of Object.keys(HOME_COPY_EN.features) as Array<keyof typeof HOME_COPY_EN.features>) {
    assert.equal(
      HOME_COPY_ES.features[key].badges?.length,
      HOME_COPY_EN.features[key].badges?.length,
      key,
    );
  }
  // Each home page advertises the other locale, crossing the boundary.
  assert.equal(localeFromPathname(HOME_COPY_EN.languageNotice.href), "es");
  assert.equal(localeFromPathname(HOME_COPY_ES.languageNotice.href), "en");
  // Spanish internal links stay inside /es.
  assert.equal(localeFromPathname(HOME_COPY_ES.hero.aboutHref), "es");
  assert.equal(localeFromPathname(HOME_COPY_ES.hero.nameHref), "es");
  // Docs are English-only, so the Spanish page must say so.
  assert.ok(HOME_COPY_ES.hero.contentLanguageNote);
});

test("Spanish home copy strings contain no em dash", async () => {
  const { HOME_COPY_ES } = await import("../../components/home/home-copy-es");
  const strings: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object" && !("$$typeof" in value)) {
      Object.values(value).forEach(walk);
    }
  };
  walk(HOME_COPY_ES);
  assert.ok(strings.length > 100);
  for (const text of strings) {
    assert.ok(!text.includes("—"), text.slice(0, 40));
  }
});
