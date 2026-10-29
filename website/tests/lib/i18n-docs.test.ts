import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { Card } from "../../components/cards";
import { spanishPath, switchLocaleHref, TRANSLATED_PATHS } from "../../lib/i18n";
import { parseMdxSource } from "../../lib/mdx/content";
import { mdxComponentsFor } from "../../lib/mdx/render";

const CONTENT = path.join(process.cwd(), "content");
const ES_DOCS = path.join(CONTENT, "es", "docs");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : entry.name.endsWith(".mdx")
        ? [path.join(dir, entry.name)]
        : [],
  );
}

/** `content/es/docs/a/b.mdx` → `/docs/a/b` (the English route it translates). */
function englishRouteOf(file: string): string {
  const rel = path.relative(ES_DOCS, file).split(path.sep).join("/").replace(/\.mdx$/, "");
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

const spanishFiles = walk(ES_DOCS);
const translatedDocs = TRANSLATED_PATHS.filter((p) => p.startsWith("/docs/"));

test("content/es/docs holds exactly the translated docs paths", () => {
  assert.deepEqual(spanishFiles.map(englishRouteOf).sort(), [...translatedDocs].sort());
});

test("every Spanish docs page translates an existing English page", () => {
  for (const file of spanishFiles) {
    assert.ok(englishDocExists(englishRouteOf(file)), englishRouteOf(file));
  }
});

test("Spanish docs frontmatter is valid, sized for SEO, and em-dash free", () => {
  for (const file of spanishFiles) {
    const source = readFileSync(file, "utf8");
    const { frontmatter } = parseMdxSource(source, file);
    const len = frontmatter.description.length;
    assert.ok(len >= 140 && len <= 160, `${file}: description is ${len} chars`);
    assert.ok(!source.includes("—"), `${file} contains an em dash`);
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

test("Spanish docs keep the English code samples unchanged (comments aside)", () => {
  for (const file of spanishFiles) {
    const route = englishRouteOf(file);
    const english = readFileSync(path.join(CONTENT, "docs", `${route.slice(6)}.mdx`), "utf8");
    assert.deepEqual(codeWithoutComments(readFileSync(file, "utf8")), codeWithoutComments(english), route);
  }
});

test("every internal link in the Spanish docs resolves", () => {
  for (const file of spanishFiles) {
    const source = readFileSync(file, "utf8");
    const hrefs = [
      ...[...source.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]!),
      ...[...source.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]!),
    ];
    assert.ok(hrefs.length > 0, file);
    for (const href of hrefs) {
      const route = href.split("#", 1)[0]!;
      if (route.startsWith("/es/docs/")) {
        assert.ok(
          spanishFiles.some((f) => spanishPath(englishRouteOf(f) as (typeof translatedDocs)[number]) === route),
          `${file}: ${href} is not a Spanish docs page`,
        );
      } else {
        assert.ok(route.startsWith("/docs"), `${file}: unexpected link ${href}`);
        assert.ok(englishDocExists(route), `${file}: ${href} has no English page`);
        // A translated target must be linked in Spanish, not English.
        assert.ok(!translatedDocs.includes(route as never), `${file}: link ${href} to ${spanishPath(route as never)}`);
      }
    }
  }
});

test("the language switcher maps translated docs and falls back otherwise", () => {
  assert.equal(switchLocaleHref("/docs/installation", "es"), "/es/docs/installation");
  assert.equal(switchLocaleHref("/es/docs/tutorials/bookstore", "en"), "/docs/tutorials/bookstore");
  assert.equal(switchLocaleHref("/docs/routing", "es"), "/es");
  assert.equal(switchLocaleHref("/es/docs/routing", "en"), "/");
  assert.equal(switchLocaleHref("/es/docs", "en"), "/");
});

test("Spanish MDX links into English reload the document; Spanish ones do not", () => {
  const SpanishLink = mdxComponentsFor("es").a as (props: { href: string; children: string }) => {
    type: unknown;
    props: Record<string, unknown>;
  };
  const cross = SpanishLink({ href: "/docs/routing#x", children: "x" });
  assert.equal(cross.type, "a");
  assert.equal(cross.props.hrefLang, "en");

  const same = SpanishLink({ href: "/es/docs/installation", children: "x" });
  assert.notEqual(same.type, "a");
  assert.equal(same.props.hrefLang, undefined);

  // English pages keep the original link component untouched.
  assert.notEqual(mdxComponentsFor("en").a, mdxComponentsFor("es").a);
});

test("a Card that crosses locales is a plain hreflang link", () => {
  const cross = Card({ title: "x", href: "/docs/scaffolder", locale: "es" }) as {
    type: unknown;
    props: Record<string, unknown>;
  };
  assert.equal(cross.type, "a");
  assert.equal(cross.props.hrefLang, "en");

  const same = Card({ title: "x", href: "/es/docs/installation", locale: "es" }) as { type: unknown };
  assert.notEqual(same.type, "a");

  // Without a locale (every English page) the card is unchanged.
  const plain = Card({ title: "x", href: "/es", locale: undefined }) as { type: unknown };
  assert.notEqual(plain.type, "a");
});
