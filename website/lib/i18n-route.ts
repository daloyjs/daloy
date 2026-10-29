import { notFound } from "next/navigation";

import { isTranslatedLocale, type TranslatedLocale } from "@/lib/i18n";

/**
 * Resolve the `[locale]` route param, or 404. Callers export
 * `instant = false` and await this first, so an unknown first segment
 * (`/fr`, `/foo`) is a real HTTP 404 before anything streams.
 *
 * @param params - The route's `params` promise.
 * @returns The translated locale.
 */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<TranslatedLocale> {
  const { locale } = await params;
  if (!isTranslatedLocale(locale)) notFound();
  return locale;
}
