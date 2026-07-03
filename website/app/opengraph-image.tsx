import { ImageResponse } from "next/og";
import { HOME_TITLE, SITE_NAME } from "@/lib/seo";

export const alt = `${SITE_NAME} - ${HOME_TITLE}`;
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

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
        padding: "72px",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
        <div
          style={{
            width: "96px",
            height: "96px",
            borderRadius: "22px",
            background: "#0c0c0c",
            border: "1px solid #1f2937",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="72"
            height="72"
            viewBox="0 0 72 72"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 10 22 C 28 6 44 38 62 22"
              fill="none"
              stroke="#bae6fd"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <path
              d="M 10 36 C 28 20 44 52 62 36"
              fill="none"
              stroke="#38bdf8"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <path
              d="M 10 50 C 28 34 44 66 62 50"
              fill="none"
              stroke="#0284c7"
              strokeWidth={4}
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "58px",
            fontWeight: 800,
            letterSpacing: 0,
          }}
        >
          <span style={{ color: "#ffffff" }}>Daloy</span>
          <span style={{ color: "#38bdf8" }}>JS</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div
          style={{
            fontSize: "58px",
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: 0,
          }}
        >
          The first TypeScript REST API framework built for secure AI-assisted
          services.
        </div>
        <div
          style={{
            maxWidth: "1000px",
            color: "#d4d4d4",
            fontSize: "30px",
            lineHeight: 1.35,
          }}
        >
          Runtime portability, contract-first OpenAPI, generated typed clients,
          zero-dependency guardrails, and supply-chain-aware defaults.
        </div>
      </div>
      <div style={{ color: "#a3a3a3", fontSize: "28px" }}>daloyjs.dev</div>
    </div>,
    size
  );
}
