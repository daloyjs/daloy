import {
  ogImageContentType,
  ogImageSize,
  renderReleaseOgImage,
} from "@/lib/og-image";

export const alt =
  "DaloyJS 1.0.0 is out, and almost every late bug was in the wiring between middlewares rather than inside them.";
export const size = ogImageSize;
export const contentType = ogImageContentType;

/**
 * Post-specific OpenGraph card for the 1.0.0 release note. Leads with the
 * version so the social preview reads as an announcement.
 */
export default function Image() {
  return renderReleaseOgImage({
    version: "1.0.0",
    title: "Almost every late bug was in the wiring, not the module.",
    footer: "Public API frozen · semver from here",
  });
}
