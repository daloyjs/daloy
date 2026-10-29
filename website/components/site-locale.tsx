"use client";

import * as React from "react";

import type { SiteLocale } from "@/lib/i18n";

const SiteLocaleContext = React.createContext<SiteLocale>("en");

/**
 * Provides the document's locale to client components (code-block buttons,
 * package-manager tabs) so they can label themselves without every MDX
 * component threading a prop. The root layout sets it once per document;
 * crossing locales reloads the document (see lib/i18n.ts), so it never
 * changes in place.
 *
 * @param props.locale - Locale of the current document.
 */
export function SiteLocaleProvider({
  locale,
  children,
}: {
  locale: SiteLocale;
  children: React.ReactNode;
}) {
  return <SiteLocaleContext.Provider value={locale}>{children}</SiteLocaleContext.Provider>;
}

/** The current document's locale (English outside a provider). */
export function useSiteLocale(): SiteLocale {
  return React.useContext(SiteLocaleContext);
}

/** Labels for small shared UI controls, per locale. */
export const UI_STRINGS: Record<
  SiteLocale,
  {
    copy: string;
    copied: string;
    retryCopy: string;
    copyAria: string;
    copiedAria: string;
    packageManager: string;
  }
> = {
  en: {
    copy: "Copy",
    copied: "Copied",
    retryCopy: "Retry copy",
    copyAria: "Copy code to clipboard",
    copiedAria: "Code copied to clipboard",
    packageManager: "Package manager",
  },
  es: {
    copy: "Copiar",
    copied: "Copiado",
    retryCopy: "Reintentar",
    copyAria: "Copiar el código al portapapeles",
    copiedAria: "Código copiado al portapapeles",
    packageManager: "Gestor de paquetes",
  },
  zh: {
    copy: "复制",
    copied: "已复制",
    retryCopy: "重试",
    copyAria: "将代码复制到剪贴板",
    copiedAria: "代码已复制到剪贴板",
    packageManager: "包管理器",
  },
  fr: {
    copy: "Copier",
    copied: "Copié",
    retryCopy: "Réessayer",
    copyAria: "Copier le code dans le presse-papiers",
    copiedAria: "Code copié dans le presse-papiers",
    packageManager: "Gestionnaire de paquets",
  },
};

/** {@link UI_STRINGS} for the current document. */
export function useUiStrings() {
  return UI_STRINGS[useSiteLocale()];
}
