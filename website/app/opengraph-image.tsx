import { HOME_TITLE, SITE_NAME } from "@/lib/seo";
import {
  ogImageContentType,
  ogImageSize,
  renderHomeOgImage,
} from "@/lib/og-image";

export const alt = `${SITE_NAME} - ${HOME_TITLE}`;
export const size = ogImageSize;
export const contentType = ogImageContentType;

export default function Image() {
  return renderHomeOgImage({ title: HOME_TITLE });
}
