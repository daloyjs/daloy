import { track } from "@vercel/analytics/server";

import type { GlossaryMatch } from "@/lib/docs-glossary";

/** Vercel Analytics custom event name for one non-English docs MCP search. */
export const NON_ENGLISH_SEARCH_EVENT = "mcp_search_non_english";

/** Script family of a query; coarse on purpose (no query text is kept). */
export type QueryScript = "han" | "latin" | "other";

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
};

const HAN = /\p{Script=Han}/u;
const NON_ASCII = /[^\x00-\x7f]/;

/**
 * Coarse script of a query: Han (Chinese), Latin (incl. accented Spanish),
 * or other.
 *
 * @param query - Raw query.
 * @returns The script family.
 */
export function queryScript(query: string): QueryScript {
  if (HAN.test(query)) return "han";
  if (/\p{Script=Latin}/u.test(query)) return "latin";
  return "other";
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
