import { SITE_NAME } from "@/lib/seo";
import {
  ogImageContentType,
  ogImageSize,
  renderHomeOgImage,
} from "@/lib/og-image";
import { HOME_TITLE_ES } from "@/lib/i18n-es";

export const alt = `${SITE_NAME} - ${HOME_TITLE_ES}`;
export const size = ogImageSize;
export const contentType = ogImageContentType;

export default function Image() {
  return renderHomeOgImage({
    title: HOME_TITLE_ES,
    footer: "Seguro por defecto · Cero dependencias en ejecución",
  });
}
