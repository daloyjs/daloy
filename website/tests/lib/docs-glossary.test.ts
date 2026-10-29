import { mock, test } from "node:test";
import assert from "node:assert/strict";

// lib/docs-content reads through next/cache, whose cacheLife() throws outside
// the Next.js runtime (same stub as tests/mcp/route.test.ts).
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { getAllDocPages } = await import("../../lib/docs-content");
const { rankDocPages, MAX_QUERY_TERMS, tokenize } = await import("../../lib/docs-ranking");
const {
  englishSearchQuery,
  ES_GLOSSARY,
  glossaryMatches,
  MAX_GLOSSARY_MATCHES,
  ZH_GLOSSARY,
} = await import("../../lib/docs-glossary");

/** How deep the expected page may rank for its English keywords. */
const TOP = 5;

test("every glossary mapping surfaces its expected English page", async () => {
  const pages = await getAllDocPages();
  const routes = new Set(pages.map((page) => page.href));
  const misses: string[] = [];
  for (const entry of [...ZH_GLOSSARY, ...ES_GLOSSARY]) {
    assert.ok(routes.has(entry.expect as never), `${entry.term}: ${entry.expect} is not a docs page`);
    const top = rankDocPages(pages, entry.english, TOP).map((hit) => hit.page.href);
    if (!top.includes(entry.expect as never)) misses.push(`${entry.term} → "${entry.english}": ${top.join(", ")}`);
  }
  assert.deepEqual(misses, []);
});

test("a glossary term in a full query reaches the English page end to end", async () => {
  const pages = await getAllDocPages();
  const cases: Array<[string, string]> = [
    ["如何配置限流", "/docs/security/rate-limit-redis"],
    ["中间件的执行顺序", "/docs/api-reference/middleware"],
    ["SQL 注入 防护", "/docs/security/sql-injection"],
    ["validación con zod", "/docs/validation"],
    ["Validacion de esquemas", "/docs/validation"],
    ["cómo hacer pruebas", "/docs/testing"],
    ["pruebas de contrato", "/docs/testing"],
  ];
  for (const [query, expected] of cases) {
    const english = englishSearchQuery(query, glossaryMatches(query));
    const top = rankDocPages(pages, english, TOP).map((hit) => hit.page.href);
    assert.ok(top.includes(expected as never), `${query} → ${english}: ${top.join(", ")}`);
  }
});

test("terms are unique and well-formed", () => {
  for (const [name, list] of [["zh", ZH_GLOSSARY], ["es", ES_GLOSSARY]] as const) {
    const terms = list.map((entry) => entry.term);
    assert.equal(new Set(terms).size, terms.length, `${name} has duplicate terms`);
    for (const entry of list) {
      assert.ok(entry.english.trim() && /^[a-z0-9 ]+$/.test(entry.english), `${name} ${entry.term}`);
      assert.equal(entry.term, entry.term.toLowerCase(), `${name} ${entry.term} must be lowercase`);
    }
  }
  for (const entry of ES_GLOSSARY) {
    assert.equal(entry.term, entry.term.normalize("NFD").replace(/\p{M}+/gu, ""), `${entry.term} must be accent-free`);
  }
});

test("Chinese matches prefer the longest term and use each span once", () => {
  assert.deepEqual(glossaryMatches("速率限制"), [{ source: "速率限制", english: "rate limit" }]);
  assert.deepEqual(
    glossaryMatches("单元测试").map((m) => m.source),
    ["单元测试"],
  );
  assert.deepEqual(
    glossaryMatches("身份认证").map((m) => m.source),
    ["身份认证"],
  );
});

test("Spanish matches whole words only, ignoring accents and case", () => {
  assert.deepEqual(glossaryMatches("Validación").map((m) => m.english), ["validation"]);
  assert.deepEqual(glossaryMatches("la base de datos").map((m) => m.english), ["databases"]);
  // Inside another word: no match ("rutas" in "rutasx", "pagos" in "pagosa").
  assert.deepEqual(glossaryMatches("rutasx pagosa"), []);
  // English queries are untouched.
  assert.deepEqual(glossaryMatches("rate limit middleware"), []);
  assert.equal(englishSearchQuery("rate limit", []), "rate limit");
});

test("expansion is bounded and keeps the English terms ahead of the term cap", () => {
  const everything = ZH_GLOSSARY.map((entry) => entry.term).join("");
  const matches = glossaryMatches(everything);
  assert.equal(matches.length, MAX_GLOSSARY_MATCHES);
  const english = englishSearchQuery(everything, matches);
  const terms = tokenize(english);
  assert.ok(terms.length <= MAX_QUERY_TERMS);
  assert.ok(terms.includes(tokenize(matches[0]!.english)[0]!), "first mapping survives the cap");
});

test("hostile input stays inert", () => {
  for (const input of ["", " ", "\u0000\u0000", "<script>限流</script>", "限".repeat(256), "%E9%99%90%E6%B5%81"]) {
    const matches = glossaryMatches(input);
    assert.ok(matches.length <= MAX_GLOSSARY_MATCHES);
    for (const match of matches) assert.match(match.english, /^[a-z0-9 ]+$/);
  }
  // The NUL markers used to consume spans never leak into the output.
  assert.ok(!englishSearchQuery("限流", glossaryMatches("限流")).startsWith("\u0000"));
});

test("Spanish function words are dropped only once the glossary fired", () => {
  assert.equal(englishSearchQuery("cómo hacer pruebas con zod", glossaryMatches("cómo hacer pruebas con zod")), "testing zod");
  // No glossary match: the query is left exactly as typed.
  assert.equal(englishSearchQuery("de la", glossaryMatches("de la")), "de la");
});

test("the expected page ranks first for the end-to-end Spanish case", async () => {
  const pages = await getAllDocPages();
  const query = "pruebas de contrato";
  const top = rankDocPages(pages, englishSearchQuery(query, glossaryMatches(query)), 1);
  assert.equal(top[0]?.page.href, "/docs/testing");
});
