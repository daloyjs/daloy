import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Card } from "../../components/cards";
import {
  localeFromPathname,
  localizedPath,
  switchLocaleHref,
  TRANSLATED_LOCALES,
  TRANSLATED_PATHS,
  type TranslatedLocale,
  type TranslatedPath,
} from "../../lib/i18n";
import { parseMdxSource } from "../../lib/mdx/content";
import { mdxComponentsFor } from "../../lib/mdx/render";

const CONTENT = path.join(process.cwd(), "content");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : entry.name.endsWith(".mdx")
        ? [path.join(dir, entry.name)]
        : [],
  );
}

/** `content/<locale>/docs/a/b.mdx` → `/docs/a/b` (the English route it translates). */
function englishRouteOf(locale: TranslatedLocale, file: string): string {
  const root = path.join(CONTENT, locale, "docs");
  const rel = path.relative(root, file).split(path.sep).join("/").replace(/\.mdx$/, "");
  return `/docs/${rel}`;
}

/** Whether an English docs route has an MDX file behind it. */
function englishDocExists(route: string): boolean {
  const rel = route === "/docs" ? "index" : route.slice("/docs/".length);
  return (
    existsSync(path.join(CONTENT, "docs", `${rel}.mdx`)) ||
    existsSync(path.join(CONTENT, "docs", rel, "index.mdx"))
  );
}

const translatedDocs = TRANSLATED_PATHS.filter((p) => p.startsWith("/docs/"));
const filesByLocale = Object.fromEntries(
  TRANSLATED_LOCALES.map((locale) => [locale, walk(path.join(CONTENT, locale, "docs"))]),
) as Record<TranslatedLocale, string[]>;

/** Meta description length targets: Latin script vs CJK (same snippet width). */
const DESCRIPTION_RANGE: Record<TranslatedLocale, [number, number]> = {
  es: [140, 160],
  zh: [40, 90],
  fr: [140, 160],
  pt: [140, 160],
  // Arabic packs more per character than Latin script; this fills the same snippet.
  ar: [100, 160],
  ru: [140, 160],
  // Japanese, like Chinese, fits the snippet in fewer characters.
  ja: [40, 90],
  de: [140, 160],
};

test("each content/<locale>/docs holds exactly the translated docs paths", () => {
  for (const locale of TRANSLATED_LOCALES) {
    assert.deepEqual(
      filesByLocale[locale].map((file) => englishRouteOf(locale, file)).sort(),
      [...translatedDocs].sort(),
      locale,
    );
  }
});

test("no content tree exists for a locale the site does not serve", () => {
  const trees = readdirSync(CONTENT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(CONTENT, entry.name, "docs")) && entry.name !== "docs")
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(trees, [...TRANSLATED_LOCALES].sort());
});

test("every translated docs page translates an existing English page", () => {
  for (const locale of TRANSLATED_LOCALES) {
    for (const file of filesByLocale[locale]) {
      assert.ok(englishDocExists(englishRouteOf(locale, file)), file);
    }
  }
});

test("translated docs frontmatter is valid, sized for SEO, and em-dash free", () => {
  for (const locale of TRANSLATED_LOCALES) {
    const [min, max] = DESCRIPTION_RANGE[locale];
    for (const file of filesByLocale[locale]) {
      const source = readFileSync(file, "utf8");
      const { frontmatter } = parseMdxSource(source, file);
      const len = frontmatter.description.length;
      assert.ok(len >= min && len <= max, `${file}: description is ${len} chars`);
      assert.ok(!source.includes("—"), `${file} contains an em dash`);
    }
  }
});

/** Code fences with comments removed: translated comments are fine, code is not. */
function codeWithoutComments(source: string): string[] {
  const blocks = [...source.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1] ?? "");
  return blocks.map((block) =>
    block
      .split("\n")
      .filter((line) => !/^\s*(\/\/|#)/.test(line))
      .map((line) => line.replace(/\s+\/\/\s.*$/, "").replace(/\s+\/\*.*?\*\//g, ""))
      .join("\n"),
  );
}

test("translated docs keep the English code samples unchanged (comments aside)", () => {
  for (const locale of TRANSLATED_LOCALES) {
    for (const file of filesByLocale[locale]) {
      const route = englishRouteOf(locale, file);
      const english = readFileSync(path.join(CONTENT, "docs", `${route.slice(6)}.mdx`), "utf8");
      const translated = codeWithoutComments(readFileSync(file, "utf8"));
      assert.ok(translated.length > 0, file);
      assert.deepEqual(translated, codeWithoutComments(english), `${locale} ${route}`);
    }
  }
});

test("every internal link in the translated docs resolves", () => {
  for (const locale of TRANSLATED_LOCALES) {
    const own = new Set(filesByLocale[locale].map((f) => localizedPath(englishRouteOf(locale, f) as TranslatedPath, locale)));
    for (const file of filesByLocale[locale]) {
      const source = readFileSync(file, "utf8");
      const hrefs = [
        ...[...source.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]!),
        ...[...source.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!),
      ];
      assert.ok(hrefs.length > 0, file);
      for (const href of hrefs) {
        const route = href.split("#", 1)[0]!;
        const target = localeFromPathname(route);
        if (target === locale) {
          assert.ok(own.has(route), `${file}: ${href} is not a ${locale} docs page`);
        } else {
          assert.equal(target, "en", `${file}: ${href} jumps to another translation`);
          assert.ok(route.startsWith("/docs"), `${file}: unexpected link ${href}`);
          assert.ok(englishDocExists(route), `${file}: ${href} has no English page`);
          // A translated target must be linked in this locale, not English.
          assert.ok(
            !translatedDocs.includes(route as never),
            `${file}: link ${href} as ${localizedPath(route as TranslatedPath, locale)}`,
          );
        }
      }
    }
  }
});

test("the language switcher maps translated docs and falls back otherwise", () => {
  assert.equal(switchLocaleHref("/docs/installation", "zh"), "/zh/docs/installation");
  assert.equal(switchLocaleHref("/zh/docs/tutorials/bookstore", "es"), "/es/docs/tutorials/bookstore");
  assert.equal(switchLocaleHref("/es/docs/tutorials/bookstore", "en"), "/docs/tutorials/bookstore");
  assert.equal(switchLocaleHref("/docs/routing", "zh"), "/zh");
  assert.equal(switchLocaleHref("/zh/docs/routing", "en"), "/");
  assert.equal(switchLocaleHref("/zh/docs", "en"), "/");
});

type Element = { type: unknown; props: Record<string, unknown> };

test("translated MDX links into another locale reload the document", () => {
  for (const locale of TRANSLATED_LOCALES) {
    const LocaleLink = mdxComponentsFor(locale).a as (props: { href: string; children: string }) => Element;
    const toEnglish = LocaleLink({ href: "/docs/routing#x", children: "x" });
    assert.equal(toEnglish.type, "a", locale);
    assert.equal(toEnglish.props.hrefLang, "en");

    const other = TRANSLATED_LOCALES.find((l) => l !== locale)!;
    const toOther = LocaleLink({ href: `/${other}/docs/installation`, children: "x" });
    assert.equal(toOther.type, "a", `${locale} -> ${other}`);

    const same = LocaleLink({ href: `/${locale}/docs/installation`, children: "x" });
    assert.notEqual(same.type, "a", locale);
    assert.equal(same.props.hrefLang, undefined);
  }
  // English pages keep the original link component untouched.
  assert.notEqual(mdxComponentsFor("en").a, mdxComponentsFor("zh").a);
});

test("a Card that crosses locales is a plain hreflang link", () => {
  const cross = Card({ title: "x", href: "/docs/scaffolder", locale: "zh" }) as Element;
  assert.equal(cross.type, "a");
  assert.equal(cross.props.hrefLang, "en");

  const toSpanish = Card({ title: "x", href: "/es/docs", locale: "zh" }) as Element;
  assert.equal(toSpanish.props.hrefLang, "es-ES");

  const same = Card({ title: "x", href: "/zh/docs/installation", locale: "zh" }) as Element;
  assert.notEqual(same.type, "a");

  // Without a locale (every English page) the card is unchanged.
  const plain = Card({ title: "x", href: "/zh", locale: undefined }) as Element;
  assert.notEqual(plain.type, "a");
});

test("translated docs routes resolve to their own content file for git dates", async () => {
  const { lastModifiedIso, sourceFileForRoute } = await import("../../lib/git-dates");
  for (const locale of TRANSLATED_LOCALES) {
    for (const english of translatedDocs) {
      const route = localizedPath(english, locale);
      assert.equal(sourceFileForRoute(route), `content${route}.mdx`, route);
    }
  }
  const dates = { "content/zh/docs/installation.mdx": "2026-10-29T11:36:16-06:00" };
  assert.equal(lastModifiedIso("/zh/docs/installation", dates), "2026-10-29T11:36:16-06:00");
  // No date for a translated page git has not seen, rather than a fake one.
  assert.equal(lastModifiedIso("/es/docs/installation", dates), undefined);
});
