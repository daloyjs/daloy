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
    description:
      "Notes, stories, and field reports from the people building DaloyJS, the runtime-portable TypeScript framework with secure-by-default guardrails.",
    path: "/blog",
  });
}
