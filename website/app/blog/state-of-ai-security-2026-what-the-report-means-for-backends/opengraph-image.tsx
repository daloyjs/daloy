import {
  ogImageContentType,
  ogImageSize,
  renderStatsOgImage,
} from "@/lib/og-image";

export const alt =
  "The State of AI in Security 2026: AI writes 24% of production code and 1 in 5 teams had a serious incident because of it.";
export const size = ogImageSize;
export const contentType = ogImageContentType;

/**
 * Post-specific OpenGraph card for the State of AI in Security 2026 write-up.
 * Leads with the report's three headline numbers.
 */
export default function Image() {
  return renderStatsOgImage({
    label: "Field Report",
    kicker: "State of AI in Security 2026",
    title: "AI writes 24% of your code. 1 in 5 teams paid for it.",
    stats: [
      {
        value: "24%",
        label: "of production code is AI-written",
        accent: "#38bdf8",
      },
      {
        value: "1 in 5",
        label: "had a serious AI-code incident",
        accent: "#f87171",
      },
      {
        value: "~$20M",
        label: "a year lost to alert noise",
        accent: "#fbbf24",
      },
    ],
    footerLeft: "daloyjs.dev/blog",
    footerRight: "450 teams · Aikido / Sapio",
  });
}
