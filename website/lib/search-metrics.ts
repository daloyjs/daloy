import { track } from "@vercel/analytics/server";

import type { GlossaryMatch } from "@/lib/docs-glossary";

/** Vercel Analytics custom event name for one non-English docs MCP search. */
export const NON_ENGLISH_SEARCH_EVENT = "mcp_search_non_english";

/** Script family of a query; coarse on purpose (no query text is kept). */
export type QueryScript = "kana" | "han" | "arabic" | "cyrillic" | "latin" | "other";

/**
 * Aggregate-only facts about one non-English search. No query text, no
 * matched terms, no identifiers: just enough to answer "do non-English
 * searches find anything, and does the glossary help?".
 */
export type NonEnglishSearchSignal = {
  script: QueryScript;
  /** Whether the English docs returned any page (after the glossary). */
  englishResults: "none" | "some";
  /** The same question without the glossary: the glossary's measured value. */
  englishResultsWithoutGlossary: "none" | "some";
  translatedResults: "none" | "some";
  /** Glossary mappings applied (0 to MAX_GLOSSARY_MATCHES). */
  glossaryTerms: number;
  /**
   * Languages of the glossary lists that matched, sorted and joined with
   * "+" (for example "de" or "es+pt"), or "none". Language codes only, never
   * the matched terms. See {@link glossaryLanguages}.
   */
  glossaryLanguages: string;
};

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;
const ARABIC = /\p{Script=Arabic}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const NON_ASCII = /[^\x00-\x7f]/;

/**
 * Coarse script of a query: kana (Japanese, checked first because Japanese
 * also writes kanji), Han (Chinese), Arabic, Cyrillic (Russian), Latin
 * (incl. accented Spanish), or other. A query mixing scripts takes the first
 * of these it contains, so "rate limit для API" counts as Cyrillic.
 *
 * @param query - Raw query.
 * @returns The script family.
 */
export function queryScript(query: string): QueryScript {
  if (KANA.test(query)) return "kana";
  if (HAN.test(query)) return "han";
  if (ARABIC.test(query)) return "arabic";
  if (CYRILLIC.test(query)) return "cyrillic";
  if (/\p{Script=Latin}/u.test(query)) return "latin";
  return "other";
}

/**
 * Which glossary lists a search used, for the counter. Spanish, French,
 * Portuguese and German share the Latin script, so this is the only way to
 * tell them apart. Bounded: at most the eight translated locale codes.
 *
 * @param matches - Glossary mappings applied to the query.
 * @returns Sorted, de-duplicated language codes joined with "+", or "none".
 */
export function glossaryLanguages(matches: readonly GlossaryMatch[]): string {
  const languages = [...new Set(matches.map((match) => match.language))].sort();
  return languages.length > 0 ? languages.join("+") : "none";
}

/**
 * Whether a search counts as non-English: it contains a non-ASCII character
 * (Chinese, accented Spanish) or matched a glossary term (unaccented
 * Spanish such as "pruebas").
 *
 * @param query - Raw query.
 * @param matches - Glossary mappings applied to it.
 * @returns `true` when the search should be counted.
 */
export function isNonEnglishSearch(query: string, matches: readonly GlossaryMatch[]): boolean {
  return NON_ASCII.test(query) || matches.length > 0;
}

/**
 * Count one non-English search in Vercel Analytics, fire-and-forget.
 *
 * Privacy: only {@link NonEnglishSearchSignal} is sent. The caller's IP,
 * cookies and user agent are NOT forwarded (`track()` would otherwise copy
 * them from the request): a fixed user agent is the only header, so the event
 * cannot be tied to a visitor. Runs only on the production deployment; dev,
 * tests and previews send nothing. Failures are swallowed so counting can
 * never break a search.
 *
 * @param signal - The aggregate facts to count.
 * @returns Nothing; the request is not awaited.
 */
export function recordNonEnglishSearch(signal: NonEnglishSearchSignal): void {
  if (process.env.VERCEL_ENV !== "production") return;
  try {
    void track(NON_ENGLISH_SEARCH_EVENT, signal, {
      headers: { "user-agent": "daloyjs-docs-mcp-counter" },
    }).catch(() => undefined);
  } catch {
    // Never let analytics affect the tool result.
  }
}
