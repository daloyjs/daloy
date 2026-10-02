import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

import { previewTarget } from "../../components/docs-link-preview";
import { searchDocs } from "../../components/docs-search";
import { queryFromPath } from "../../components/not-found-suggestions";
import type { DocsSearchItem } from "../../lib/docs-search";

const item = (title: string, href: string, section: string, body = ""): DocsSearchItem => ({
  title,
  href: href as DocsSearchItem["href"],
  description: `${title} docs`,
  keywords: [section],
  body,
  section,
});

const INDEX = [
  item("Routing", "/docs/routing", "Core concepts", "define routes with app.get"),
  item("Rate limiting", "/docs/security/rate-limit", "Security", "limit requests per window"),
  item("Request timeouts", "/docs/security/timeouts", "Security", "route handlers get a timeout"),
];

test("searchDocs puts title-prefix matches in Jump to, ranked rest in results", () => {
  const { jumps, results } = searchDocs(INDEX, "rout", null);
  assert.deepEqual(jumps.map((i) => i.href), ["/docs/routing"]);
  assert.ok(!results.some((i) => (i.href as string) === "/docs/routing"), "jumps and results are disjoint");
});

test("searchDocs ranks body matches and honors the section filter", () => {
  assert.equal(searchDocs(INDEX, "requests per window", null).results[0]?.href, "/docs/security/rate-limit");
  const scoped = searchDocs(INDEX, "route", "Security");
  assert.ok([...scoped.jumps, ...scoped.results].every((i) => i.section === "Security"));
});

test("searchDocs returns nothing for an empty or unmatched query", () => {
  assert.deepEqual(searchDocs(INDEX, "   ", null), { jumps: [], results: [] });
  assert.deepEqual(searchDocs(INDEX, "zzzqqq", null), { jumps: [], results: [] });
});

test("queryFromPath turns a missing URL into search words", () => {
  assert.equal(queryFromPath("/docs/rate-limits/redis"), "rate limits redis");
  assert.equal(queryFromPath("/docs/Routing.md"), "routing");
  assert.equal(queryFromPath("/%E0%A4%A"), "e0 a4 a");
  assert.equal(queryFromPath("/docs"), "");
});

test("previewTarget only previews other internal docs pages", () => {
  const { document } = parseHTML("<html><body></body></html>");
  const link = (href: string) => {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    return a as unknown as HTMLAnchorElement;
  };
  assert.equal(previewTarget(link("/docs/routing#params"), "/docs/installation"), "/docs/routing");
  assert.equal(previewTarget(link("/docs/routing/"), "/docs/installation"), "/docs/routing");
  assert.equal(previewTarget(link("/docs/installation#x"), "/docs/installation"), null);
  assert.equal(previewTarget(link("https://evil.example/docs/x"), "/docs"), null);
  assert.equal(previewTarget(link("#local"), "/docs"), null);
  assert.equal(previewTarget(link("/blog/post"), "/docs"), null);
});

test("ranker matches word prefixes, not substrings inside words", () => {
  const pages = [
    item("Integrate Shopify", "/docs/payments/shopify", "Payments"),
    item("Rate limiting", "/docs/security/rate-limit", "Security"),
  ];
  const { results, jumps } = searchDocs(pages, "rate", null);
  assert.deepEqual([...jumps, ...results].map((i) => i.href), ["/docs/security/rate-limit"]);
});
