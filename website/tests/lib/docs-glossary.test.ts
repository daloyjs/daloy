import { mock, test } from "node:test";
import assert from "node:assert/strict";

// lib/docs-content reads through next/cache, whose cacheLife() throws outside
// the Next.js runtime (same stub as tests/mcp/route.test.ts).
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { getAllDocPages } = await import("../../lib/docs-content");
const { rankDocPages, MAX_QUERY_TERMS, tokenize } = await import("../../lib/docs-ranking");
const { foldArabic } = await import("../../lib/arabic");
const {
  AR_GLOSSARY,
  DE_GLOSSARY,
  englishSearchQuery,
  RU_GLOSSARY,
  ES_GLOSSARY,
  FR_GLOSSARY,
  PT_GLOSSARY,
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
  for (const entry of [...ZH_GLOSSARY, ...ES_GLOSSARY, ...FR_GLOSSARY, ...PT_GLOSSARY, ...AR_GLOSSARY, ...RU_GLOSSARY, ...DE_GLOSSARY]) {
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
    ["journalisation des requêtes", "/docs/logging"],
    ["Limitation de débit", "/docs/security/rate-limit-redis"],
    ["chaîne d’approvisionnement", "/docs/security/supply-chain"],
    ["les tests de contrat", "/docs/testing"],
    ["rastreamento distribuído", "/docs/tracing"],
    ["limite de requisições por IP", "/docs/security/rate-limit-redis"],
    ["validação com zod", "/docs/validation"],
    ["como fazer testes de contrato", "/docs/testing"],
    ["كيف أضبط تحديد المعدل؟", "/docs/security/rate-limit-redis"],
    ["البرمجيات الوسيطة", "/docs/api-reference/middleware"],
    ["إعادة التوجيه الآمنة", "/docs/security/safe-redirect"],
    ["سلسلة التوريد", "/docs/security/supply-chain"],
    ["как настроить ограничение частоты запросов", "/docs/security/rate-limit-redis"],
    ["Маршрутизация", "/docs/routing"],
    ["подключение к базе данных", "/docs/databases"],
    ["контрактные тесты", "/docs/testing"],
    ["Wie konfiguriere ich die Ratenbegrenzung?", "/docs/security/rate-limit-redis"],
    ["Lieferkettensicherheit", "/docs/security/supply-chain"],
    ["Datenbankverbindung", "/docs/databases"],
    ["Fehlerbehandlung", "/docs/errors"],
  ];
  for (const [query, expected] of cases) {
    const english = englishSearchQuery(query, glossaryMatches(query));
    const top = rankDocPages(pages, english, TOP).map((hit) => hit.page.href);
    assert.ok(top.includes(expected as never), `${query} → ${english}: ${top.join(", ")}`);
  }
});

test("terms are unique and well-formed", () => {
  for (const [name, list] of [["zh", ZH_GLOSSARY], ["es", ES_GLOSSARY], ["fr", FR_GLOSSARY], ["pt", PT_GLOSSARY], ["ar", AR_GLOSSARY], ["ru", RU_GLOSSARY], ["de", DE_GLOSSARY]] as const) {
    const terms = list.map((entry) => entry.term);
    assert.equal(new Set(terms).size, terms.length, `${name} has duplicate terms`);
    for (const entry of list) {
      assert.ok(entry.english.trim() && /^[a-z0-9 ]+$/.test(entry.english), `${name} ${entry.term}`);
      assert.equal(entry.term, entry.term.toLowerCase(), `${name} ${entry.term} must be lowercase`);
    }
  }
  for (const entry of [...ES_GLOSSARY, ...FR_GLOSSARY, ...PT_GLOSSARY]) {
    assert.equal(entry.term, entry.term.normalize("NFD").replace(/\p{M}+/gu, ""), `${entry.term} must be accent-free`);
    assert.match(entry.term, /^[a-z0-9 ]+$/, `${entry.term} must be folded (no apostrophes or hyphens)`);
  }
  // Spanish, French and Portuguese share one matcher, so a term may not
  // appear twice (or mean two things).
  const latinTerms = [...ES_GLOSSARY, ...FR_GLOSSARY, ...PT_GLOSSARY].map((entry) => entry.term);
  const dupes = latinTerms.filter((term, index) => latinTerms.indexOf(term) !== index);
  assert.deepEqual(dupes, [], "es/fr/pt term collision");
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

test("Arabic terms are stored folded and match spelling variants", () => {
  for (const entry of AR_GLOSSARY) {
    assert.equal(entry.term, foldArabic(entry.term), `${entry.term} must be stored folded`);
  }
  // Diacritics, hamza on alef, ta marbuta and the article all still match.
  assert.deepEqual(glossaryMatches("التَّوْجِيه").map((m) => m.english), ["routing"]);
  assert.deepEqual(glossaryMatches("إعادة التوجيه").map((m) => m.english), ["safe redirect"]);
  assert.deepEqual(glossaryMatches("بالمصادقة").map((m) => m.english), ["authentication"]);
  // Longest first: "authentication" wins over the shorter "validation" inside it.
  assert.deepEqual(glossaryMatches("التحقق من الهوية").map((m) => m.english), ["authentication"]);
});

test("Arabic folding normalizes only Arabic text", () => {
  assert.equal(foldArabic("أإآٱ"), "اااا");
  assert.equal(foldArabic("مستشفى مدرسة"), "مستشفي مدرسه");
  assert.equal(foldArabic("تَـــثْبِيت"), "تثبيت");
  assert.equal(foldArabic("rate limit"), "rate limit");
});

test("Russian terms are folded stems that match any case form", async () => {
  const { foldCyrillic, stemRussian } = await import("../../lib/cyrillic");
  for (const entry of RU_GLOSSARY) {
    assert.equal(entry.term, foldCyrillic(entry.term), `${entry.term} must be folded (no ё)`);
  }
  // Nominative, genitive, accusative and plural all reach the same mapping.
  for (const form of ["установка", "установки", "установку", "установок", "установить"]) {
    assert.deepEqual(glossaryMatches(form).map((m) => m.english), ["installation"], form);
  }
  // Multi-word stems must be consecutive and in order.
  assert.deepEqual(glossaryMatches("частоты ограничение").map((m) => m.english), []);
  // Fleeting vowels in the genitive plural still match ("ошибок", "заголовков").
  assert.deepEqual(glossaryMatches("обработка ошибок").map((m) => m.english), ["errors"]);
  assert.deepEqual(glossaryMatches("заголовков безопасности").map((m) => m.english), ["secure headers"]);
  // The longer term consumes its words: "маршрут" does not re-match.
  assert.deepEqual(glossaryMatches("маршрутизация").map((m) => m.english), ["routing"]);
  assert.equal(stemRussian("развертывание"), stemRussian("развертывания"));
  assert.equal(foldCyrillic("развёртывание"), "развертывание");
});

test("German terms match inside compounds, folded and longest first", () => {
  for (const entry of DE_GLOSSARY) {
    assert.match(entry.term, /^[a-z0-9 ]+$/, `${entry.term} must be folded (no umlauts or ß)`);
    assert.ok(entry.term.length >= 6, `${entry.term} is too short to match safely inside words`);
  }
  assert.deepEqual(glossaryMatches("Abhängigkeitsprüfung").map((m) => m.english), ["dependencies supply chain"]);
  assert.deepEqual(glossaryMatches("Zustandsprüfung").map((m) => m.english), ["health check"]);
  // "dekomprimierung" is consumed before the shorter "komprimierung" inside it.
  assert.deepEqual(glossaryMatches("Dekomprimierung").map((m) => m.english), ["decompression"]);
  // Function words are dropped once German is recognised; English words stay.
  assert.equal(englishSearchQuery("die Ratenbegrenzung mit Redis", glossaryMatches("die Ratenbegrenzung mit Redis")), "rate limit Ratenbegrenzung Redis");
});
