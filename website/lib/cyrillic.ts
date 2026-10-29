/**
 * Russian text helpers for search. Russian inflects nouns by case and number
 * ("установка", "установки", "установку"), so exact word matching misses most
 * queries. A light suffix stripper reduces each form to a shared stem; it is a
 * matching heuristic, not a morphological analyser, and a wrong stem only
 * costs one fuzzy match. Pure string functions: safe in client components.
 */

const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Inflectional endings, longest first so "-ями" wins over "-и". Covers the
 * common noun and adjective case endings. The ranker compares stems by
 * prefix, so "установ" (from установок) still matches "установк".
 */
const ENDINGS = [
  "иями", "ями", "ами", "ией", "ого", "его", "ому", "ему", "ыми", "ими", "ых", "их",
  "ов", "ев", "ей", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю",
  // Genitive plural with a fleeting vowel: установок, ошибок, задачек.
  "ок", "ек",
  "ам", "ям", "ах", "ях", "ом", "ем", "ию", "ия", "ья", "ье", "ью",
  "а", "я", "о", "е", "ы", "и", "у", "ю", "ь",
] as const;

/**
 * Whether text contains Cyrillic script.
 *
 * @param text - Any text.
 * @returns `true` when at least one Cyrillic character is present.
 */
export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text);
}

/**
 * Fold ё to е (Russian text uses them interchangeably). Other text is
 * returned unchanged.
 *
 * @param text - Lowercase text.
 * @returns The folded text.
 */
export function foldCyrillic(text: string): string {
  return text.replace(/ё/g, "е").replace(/Ё/g, "Е");
}

/**
 * Strip one inflectional ending from a lowercase Russian word, keeping at
 * least four characters, so case forms share a stem: "установки" and
 * "установка" both become "установк".
 *
 * @param word - A lowercase, folded Cyrillic token.
 * @returns The stem (the word itself when too short to strip).
 */
export function stemRussian(word: string): string {
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= 4 && word.endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}
