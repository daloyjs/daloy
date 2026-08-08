import {
  ogImageContentType,
  ogImageSize,
  renderPageOgImage,
} from "@/lib/og-image";

export const alt = "DaloyJS documentation";
export const size = ogImageSize;
export const contentType = ogImageContentType;

export default function Image() {
  return renderPageOgImage({
    label: "Docs",
    title: "Documentation",
    path: "/docs",
  });
}
