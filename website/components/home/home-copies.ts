import type { TranslatedLocale } from "@/lib/i18n";

import type { HomeCopy } from "./home-copy";
import { HOME_COPY_AR } from "./home-copy-ar";
import { HOME_COPY_DE } from "./home-copy-de";
import { HOME_COPY_ES } from "./home-copy-es";
import { HOME_COPY_FR } from "./home-copy-fr";
import { HOME_COPY_PT } from "./home-copy-pt";
import { HOME_COPY_RU } from "./home-copy-ru";
import { HOME_COPY_ZH } from "./home-copy-zh";

/** Landing-page copy for every translated locale. */
export const HOME_COPIES: Record<TranslatedLocale, HomeCopy> = {
  es: HOME_COPY_ES,
  zh: HOME_COPY_ZH,
  fr: HOME_COPY_FR,
  pt: HOME_COPY_PT,
  ar: HOME_COPY_AR,
  ru: HOME_COPY_RU,
  de: HOME_COPY_DE,
};
