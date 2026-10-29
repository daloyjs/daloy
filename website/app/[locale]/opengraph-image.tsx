import { HOME_TITLE, SITE_NAME } from "@/lib/seo";
import { PAGES_COPY } from "@/lib/i18n-pages";
import { resolveLocale } from "@/lib/i18n-route";
import {
  ogImageContentType,
  ogImageSize,
  renderHomeOgImage,
} from "@/lib/og-image";

export const alt = SITE_NAME;
export const size = ogImageSize;
export const contentType = ogImageContentType;

/**
 * Localized home card. A locale with `ogFooter: null` (Chinese: the OG
 * renderer ships Latin fonts only) gets the English card instead of empty
 * glyph boxes.
 */
export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const home = PAGES_COPY[await resolveLocale(params)].home;
  return home.ogFooter === null
    ? renderHomeOgImage({ title: HOME_TITLE })
    : renderHomeOgImage({ title: home.title, footer: home.ogFooter });
}
