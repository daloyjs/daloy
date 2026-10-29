import type { TranslatedLocale } from "@/lib/i18n";

import type { HomeCopy } from "./home-copy";
import { HOME_COPY_ES } from "./home-copy-es";
import { HOME_COPY_FR } from "./home-copy-fr";
import { HOME_COPY_ZH } from "./home-copy-zh";

/** Landing-page copy for every translated locale. */
export const HOME_COPIES: Record<TranslatedLocale, HomeCopy> = {
  es: HOME_COPY_ES,
  zh: HOME_COPY_ZH,
  fr: HOME_COPY_FR,
};
