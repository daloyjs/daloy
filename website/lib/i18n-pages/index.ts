import type { TranslatedLocale } from "@/lib/i18n";

import { PAGES_COPY_AR } from "./ar";
import { PAGES_COPY_DE } from "./de";
import { PAGES_COPY_ES } from "./es";
import { PAGES_COPY_FR } from "./fr";
import { PAGES_COPY_JA } from "./ja";
import { PAGES_COPY_PT } from "./pt";
import { PAGES_COPY_RU } from "./ru";
import type { TranslatedPagesCopy } from "./types";
import { PAGES_COPY_ZH } from "./zh";

export type { InlineLink, PageMeta, TranslatedPagesCopy } from "./types";

/** Translated-page copy for every translated locale. */
export const PAGES_COPY: Record<TranslatedLocale, TranslatedPagesCopy> = {
  es: PAGES_COPY_ES,
  zh: PAGES_COPY_ZH,
  fr: PAGES_COPY_FR,
  pt: PAGES_COPY_PT,
  ar: PAGES_COPY_AR,
  ru: PAGES_COPY_RU,
  de: PAGES_COPY_DE,
  ja: PAGES_COPY_JA,
};
