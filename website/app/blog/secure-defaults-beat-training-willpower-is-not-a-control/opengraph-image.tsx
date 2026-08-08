import {
  ogImageContentType,
  ogImageSize,
  renderStatsOgImage,
} from "@/lib/og-image";

export const alt =
  "Willpower is not a security control: secure defaults beat training, and AI does not fix that.";
export const size = ogImageSize;
export const contentType = ogImageContentType;

/**
 * Post-specific OpenGraph card for the DevSecStation-inspired defaults post.
 * Leads with the thesis and three principle tiles.
 */
export default function Image() {
  return renderStatsOgImage({
    label: "Opinion",
    kicker: "Secure defaults beat training",
    title: "Willpower is not a security control. AI does not fix that either.",
    stats: [
      {
        value: "On by default",
        label: "Secure path is the easy path",
        accent: "#38bdf8",
      },
      {
        value: "Opt-out explicit",
        label: "Insecure takes effort + intent",
        accent: "#fbbf24",
      },
      {
        value: "AI multiplies",
        label: "Whatever defaults you leave",
        accent: "#f87171",
      },
    ],
    footerLeft: "daloyjs.dev/blog",
    footerRight: "DevSecStation · SheHacksPurple",
  });
}
