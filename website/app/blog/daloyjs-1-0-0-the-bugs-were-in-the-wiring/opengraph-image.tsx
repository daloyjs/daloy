import { ImageResponse } from "next/og";

export const alt =
  "DaloyJS 1.0.0 is out, and almost every late bug was in the wiring between middlewares rather than inside them.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

/**
 * Post-specific OpenGraph card for the 1.0.0 release note. Leads with the
 * version so the social preview reads as an announcement, then carries the
 * actual finding so the card is worth sharing on its own.
 */
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0a0a0a",
        color: "#ffffff",
        padding: "64px",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "26px",
            color: "#a1a1aa",
          }}
        >
          <span style={{ color: "#ffffff", fontWeight: 700 }}>DaloyJS</span>
          <span>/</span>
          <span>Release</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "104px",
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          1.0.0
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "42px",
            fontWeight: 600,
            lineHeight: 1.25,
            maxWidth: "980px",
          }}
        >
          Almost every late bug was in the wiring, not the module.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          color: "#71717a",
          fontSize: "24px",
        }}
      >
        Public API frozen · semver from here · daloyjs.dev
      </div>
    </div>,
    { ...size }
  );
}
