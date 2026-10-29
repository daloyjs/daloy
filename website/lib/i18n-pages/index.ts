import type { TranslatedLocale } from "@/lib/i18n";

import { PAGES_COPY_ES } from "./es";
import type { TranslatedPagesCopy } from "./types";
import { PAGES_COPY_ZH } from "./zh";

export type { InlineLink, PageMeta, TranslatedPagesCopy } from "./types";

/** Translated-page copy for every translated locale. */
export const PAGES_COPY: Record<TranslatedLocale, TranslatedPagesCopy> = {
  es: PAGES_COPY_ES,
  zh: PAGES_COPY_ZH,
};
