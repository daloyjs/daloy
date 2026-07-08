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
    description:
      "Guides, API references, runtime adapters, and secure-by-default patterns for building contract-first TypeScript services with DaloyJS.",
    path: "/docs",
  });
}
