import { ImageResponse } from "next/og";

export const alt = "DaloyJS - runtime-portable TypeScript web framework";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#ffffff",
          padding: "72px",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div
            style={{
              width: "84px",
              height: "84px",
              borderRadius: "24px",
              background: "#ff5a1f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "48px",
              fontWeight: 800,
            }}
          >
            D
          </div>
          <div style={{ fontSize: "58px", fontWeight: 800, letterSpacing: 0 }}>DaloyJS</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ fontSize: "72px", fontWeight: 800, lineHeight: 1.05, letterSpacing: 0 }}>
            Runtime-portable TypeScript APIs
          </div>
          <div style={{ maxWidth: "940px", color: "#d4d4d4", fontSize: "34px", lineHeight: 1.35 }}>
            Contract-first routing, Zod validation, OpenAPI generation, typed clients, and secure defaults.
          </div>
        </div>
        <div style={{ color: "#a3a3a3", fontSize: "28px" }}>daloyjs.dev</div>
      </div>
    ),
    size,
  );
}