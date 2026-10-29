/**
 * Arabic text normalization for search. Arabic spelling varies in ways that
 * do not change the word: optional diacritics (tashkeel), the decorative
 * tatweel, hamza forms on alef, alef maqsura vs. ya, and ta marbuta vs. ha.
 * Folding them makes "التثبيت", "التَّثبيت" and "التثبيت" the same string.
 * Pure string functions: safe in client components.
 */

const ARABIC = /\p{Script=Arabic}/u;

/** Tashkeel (U+064B–U+065F), superscript alef (U+0670) and tatweel (U+0640). */
const DIACRITICS = /[ً-ٰٟـ]/g;
/** Alef with madda, hamza above/below, and wasla (آ أ إ ٱ). */
const ALEF_FORMS = /[آأإٱ]/g;

/**
 * Whether text contains Arabic script.
 *
 * @param text - Any text.
 * @returns `true` when at least one Arabic character is present.
 */
export function hasArabic(text: string): boolean {
  return ARABIC.test(text);
}

/**
 * Fold Arabic spelling variants to one form. Non-Arabic text is returned
 * unchanged, so it is safe to apply to every field.
 *
 * @param text - Text to normalize.
 * @returns The folded text.
 */
export function foldArabic(text: string): string {
  if (!hasArabic(text)) return text;
  return text
    .replace(DIACRITICS, "")
    .replace(ALEF_FORMS, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}
