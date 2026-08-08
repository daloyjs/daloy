import {
  ogImageContentType,
  ogImageSize,
  renderStatsOgImage,
} from "@/lib/og-image";

export const alt =
  "IBM Cost of a Data Breach 2026: $4.99M global average, AI-driven attacks up 56%, 92% of AI-related breaches lacked access controls.";
export const size = ogImageSize;
export const contentType = ogImageContentType;

/**
 * Post-specific OpenGraph card for the IBM Cost of a Data Breach 2026 write-up.
 * Leads with three headline numbers from the report.
 */
export default function Image() {
  return renderStatsOgImage({
    label: "Field Report",
    kicker: "IBM Cost of a Data Breach 2026",
    title:
      "$5M average. AI on both sides. Your API still owns the boring failures.",
    stats: [
      {
        value: "$4.99M",
        label: "global average breach cost (+12%)",
        accent: "#38bdf8",
      },
      {
        value: "56%",
        label: "rise in AI-driven attacks",
        accent: "#f87171",
      },
      {
        value: "92%",
        label: "AI breaches lacked access controls",
        accent: "#fbbf24",
      },
    ],
    footerLeft: "daloyjs.dev/blog",
    footerRight: "602 orgs · Ponemon / IBM",
  });
}
