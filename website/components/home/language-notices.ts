import type { SiteLocale } from "@/lib/i18n";

/**
 * The home-page pill advertising each locale, written in that locale's own
 * language so the reader who needs it can read it. Every home page shows the
 * pills of all the other locales.
 */
export const LANGUAGE_NOTICES: Record<SiteLocale, { badge: string; text: string; cta: string }> = {
  en: {
    badge: "English",
    text: "This page is also available in English.",
    cta: "Read in English",
  },
  es: {
    badge: "Nuevo",
    text: "DaloyJS ya está disponible en español de España.",
    cta: "Leer en español",
  },
  zh: {
    badge: "新",
    text: "DaloyJS 现已推出简体中文版。",
    cta: "阅读中文版",
  },
};
