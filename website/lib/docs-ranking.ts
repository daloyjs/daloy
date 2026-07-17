import type { DocPage } from "./docs-content";

/**
 * Zero-dependency relevance ranking for docs search (used by the MCP
 * `search_docs` tool in `app/mcp/route.ts`).
 *
 * Improvements over plain substring scoring:
 *
 * - **Light suffix stemming** — query and document words are reduced to a
 *   shared stem (strip trailing `s` / `es` / `ing` / `ion` / `ation` / ...),
 *   and stems match on shared prefixes, so "validate" finds "validation".
 * - **Rarity-weighted body matches** — a body hit is worth an IDF-style
 *   `log(N / df)` instead of a flat 1, so terms present in nearly every page
 *   ("request", "body") contribute ~0 while rare terms ("forgery") carry
 *   real weight. Body matches are word-boundary (stem) matches only, never
 *   raw substrings.
 * - **Adjacent-pair (bigram) body bonus** — consecutive query terms that
 *   appear consecutively in a body ("request forgery") add signal that
 *   scattered single-term noise cannot.
 * - **Distinct-term coverage bonus** — a page matching several distinct
 *   query terms in its title/route/keywords/description outranks pages with
 *   a single high-field term plus body noise.
 */

/**
 * Split a query into a deduplicated list of lowercase alphanumeric terms.
 *
 * @param query - Raw query string.
 * @returns Unique search terms in first-seen order.
 */
export function tokenize(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
}

/**
 * Suffixes stripped by {@link stem}, longest first so `-ation` wins over
 * `-ion` and `-s`. Deliberately small: this is a matching heuristic, not a
 * linguistics library, and a wrong stem only costs one fuzzy match.
 */
const STEM_SUFFIXES = [
  "izations",
  "ization",
  "ications",
  "ication",
  "ations",
  "ating",
  "ation",
  "ities",
  "ates",
  "ings",
  "ies",
  "ives",
  "ive",
  "ing",
  "ion",
  "ate",
  "ers",
  "ed",
  "es",
  "er",
  "ly",
  "s",
  "e",
] as const;

/**
 * Reduce a lowercase word to a light stem by stripping one common suffix,
 * keeping at least three characters ("validation" → "valid", "validate" →
 * "validat" → prefix-compatible with "valid"). Words too short to strip are
 * returned unchanged.
 *
 * @param word - A lowercase alphanumeric token.
 * @returns The stemmed token.
 */
export function stem(word: string): string {
  for (const suffix of STEM_SUFFIXES) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * Turn free text into a space-padded string of stemmed tokens, so callers can
 * do word-boundary stem lookups with `includes(" term ")` (exact) or
 * `includes(" term")` (shared-prefix, e.g. "valid" matching "validat...").
 */
function stemText(text: string): string {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return ` ${tokens.map(stem).join(" ")} `;
}

/**
 * Word-boundary stem match against a {@link stemText}-encoded field. Stems of
 * five or more characters also match longer words sharing the prefix
 * ("valid" ↔ "validat..."); shorter stems must match a whole word so "serv"
 * (from "server") can never match "service" and "for" can never match
 * "forgery".
 */
function stemMatch(stemmedField: string, queryStem: string): boolean {
  return queryStem.length >= 5
    ? stemmedField.includes(` ${queryStem}`)
    : stemmedField.includes(` ${queryStem} `);
}

/** Precomputed per-page search fields (lowercased raw + stemmed variants). */
type IndexedPage = {
  page: DocPage;
  title: string;
  href: string;
  keywords: string;
  description: string;
  stemmedTitle: string;
  stemmedHref: string;
  stemmedKeywords: string;
  stemmedDescription: string;
  stemmedBody: string;
};

/**
 * Index cache keyed by the pages array identity — `getAllDocPages()` memoizes
 * and returns the same array for the process lifetime, so the index builds
 * once per deployment.
 */
const indexCache = new WeakMap<readonly DocPage[], IndexedPage[]>();

function getIndex(pages: DocPage[]): IndexedPage[] {
  const cached = indexCache.get(pages);
  if (cached) return cached;
  const index = pages.map((page) => {
    const keywords = page.keywords.join(" ");
    return {
      page,
      title: page.title.toLowerCase(),
      href: page.href.toLowerCase(),
      keywords: keywords.toLowerCase(),
      description: page.description.toLowerCase(),
      stemmedTitle: stemText(page.title),
      stemmedHref: stemText(page.href),
      stemmedKeywords: stemText(keywords),
      stemmedDescription: stemText(page.description),
      stemmedBody: stemText(page.body),
    };
  });
  indexCache.set(pages, index);
  return index;
}

/** Field weights; title/route weigh most, body least (and body is IDF-scaled). */
const WEIGHT_TITLE = 10;
const WEIGHT_HREF = 6;
const WEIGHT_KEYWORDS = 4;
const WEIGHT_DESCRIPTION = 3;
/** Whole-query phrase inside the title. */
const BONUS_TITLE_PHRASE = 25;
/**
 * Two consecutive query terms appearing consecutively in the body. Compounds
 * across a longer run — a four-term phrase found verbatim earns three of
 * these — so a page containing the query as a real phrase ("server side
 * request forgery") beats pages where the same words appear scattered.
 */
const BONUS_BODY_BIGRAM = 5;
/**
 * Three consecutive query terms appearing consecutively in the body — the
 * body-side analogue of {@link BONUS_TITLE_PHRASE}. A page containing a long
 * stretch of the query verbatim is almost certainly the page being asked
 * for, even when none of the individual words are rare enough to score.
 */
const BONUS_BODY_TRIGRAM = 8;
/** Per extra distinct query term matched in title/route/keywords/description. */
const BONUS_COVERAGE_STEP = 6;
/** Ceiling for a single rare-term body match (log(N/df) is uncapped). */
const MAX_BODY_IDF = 4;

/** One ranked search hit. */
export type RankedDocPage = { page: DocPage; score: number };

/**
 * Rank docs pages against a free-text query.
 *
 * @param pages - The docs corpus (typically `getAllDocPages()`; the derived
 *   index is cached by array identity).
 * @param query - Raw user query.
 * @param limit - Maximum number of results to return.
 * @returns Pages with a positive relevance score, best first; ties break
 *   alphabetically by title for deterministic output.
 */
export function rankDocPages(
  pages: DocPage[],
  query: string,
  limit: number
): RankedDocPage[] {
  const index = getIndex(pages);
  const phrase = query.toLowerCase().trim();
  const terms = tokenize(query).map((raw) => ({ raw, stem: stem(raw) }));
  if (terms.length === 0) return [];

  // Ordered (non-deduplicated) token sequence for adjacent-pair matching.
  const sequence = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);

  // Document frequency per query term, using the same word-boundary stem
  // predicate as scoring, so the IDF weight reflects what actually matches.
  const totalPages = index.length;
  const bodyMatches = terms.map((term) =>
    index.map((entry) => stemMatch(entry.stemmedBody, term.stem))
  );

  const scored = index.map((entry, pageIdx) => {
    let score = 0;
    if (phrase.length > 0 && entry.title.includes(phrase))
      score += BONUS_TITLE_PHRASE;

    let highFieldTerms = 0;
    for (let t = 0; t < terms.length; t++) {
      const { raw, stem: qstem } = terms[t];
      let inHighField = false;
      if (entry.title.includes(raw) || stemMatch(entry.stemmedTitle, qstem)) {
        score += WEIGHT_TITLE;
        inHighField = true;
      }
      if (entry.href.includes(raw) || stemMatch(entry.stemmedHref, qstem)) {
        score += WEIGHT_HREF;
        inHighField = true;
      }
      if (
        entry.keywords.includes(raw) ||
        stemMatch(entry.stemmedKeywords, qstem)
      ) {
        score += WEIGHT_KEYWORDS;
        inHighField = true;
      }
      if (
        entry.description.includes(raw) ||
        stemMatch(entry.stemmedDescription, qstem)
      ) {
        score += WEIGHT_DESCRIPTION;
        inHighField = true;
      }
      if (inHighField) highFieldTerms++;
      if (bodyMatches[t][pageIdx]) {
        const df = bodyMatches[t].reduce((n, hit) => n + (hit ? 1 : 0), 0);
        score += Math.min(MAX_BODY_IDF, Math.log((totalPages + 1) / (df + 1)));
      }
    }

    for (let i = 0; i + 1 < sequence.length; i++) {
      if (entry.stemmedBody.includes(` ${sequence[i]} ${sequence[i + 1]} `)) {
        score += BONUS_BODY_BIGRAM;
      }
      if (
        i + 2 < sequence.length &&
        entry.stemmedBody.includes(
          ` ${sequence[i]} ${sequence[i + 1]} ${sequence[i + 2]} `
        )
      ) {
        score += BONUS_BODY_TRIGRAM;
      }
    }

    if (highFieldTerms >= 2)
      score += (highFieldTerms - 1) * BONUS_COVERAGE_STEP;

    return { page: entry.page, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title)
    )
    .slice(0, limit);
}
