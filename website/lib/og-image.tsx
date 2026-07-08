import { ImageResponse } from "next/og";

import { SITE_NAME } from "@/lib/seo";

export const ogImageSize = {
  width: 1200,
  height: 630,
};

export const ogImageContentType = "image/png";

type PageOgImageInput = {
  title: string;
  description: string;
  label: string;
  path: string;
};

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

export function renderPageOgImage(input: PageOgImageInput): ImageResponse {
  const title = clampText(input.title, 112);
  const description = clampText(input.description, 190);

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
          padding: "64px",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "18px",
                background: "#0c0c0c",
                border: "1px solid #1f2937",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="54"
                height="54"
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
            <div style={{ display: "flex", fontSize: "40px", fontWeight: 800 }}>
              <span style={{ color: "#ffffff" }}>Daloy</span>
              <span style={{ color: "#38bdf8" }}>JS</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: "999px",
              border: "1px solid #1f2937",
              background: "#0c0c0c",
              color: "#d4d4d4",
              fontSize: "22px",
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {input.label}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div
            style={{
              display: "flex",
              color: "#38bdf8",
              fontSize: "26px",
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {input.path}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 76 ? "54px" : "62px",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: 0,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: "1010px",
              color: "#d4d4d4",
              fontSize: "28px",
              lineHeight: 1.35,
            }}
          >
            {description}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#a3a3a3",
            fontSize: "24px",
          }}
        >
          <span>{SITE_NAME}</span>
          <span>daloyjs.dev</span>
        </div>
      </div>
    ),
    ogImageSize,
  );
}
