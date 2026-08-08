import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "DaloyJS blog";
export const size = ogImageSize;
export const contentType = ogImageContentType;

export default function Image() {
  return renderPageOgImage({
    label: "Blog",
    title: "Blog",
    path: "/blog",
  });
}
