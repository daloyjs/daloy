import { resolveLocale } from "@/lib/i18n-route";
import { TRANSLATED_LOCALES } from "@/lib/i18n";

// instant = false: the locale must 404 before anything streams (see
// lib/i18n-route.ts); the root layout is already blocking for the nonce CSP.
export const instant = false;

/** One subtree per translated locale: `/es/**` and `/zh/**`. */
export function generateStaticParams() {
  return TRANSLATED_LOCALES.map((locale) => ({ locale }));
}

/**
 * Gate for every translated route. `<html lang>`, the header and the footer
 * come from the root layout (locale header set in proxy.ts), so this layout
 * only refuses unknown locales.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  await resolveLocale(params);
  return children;
}
