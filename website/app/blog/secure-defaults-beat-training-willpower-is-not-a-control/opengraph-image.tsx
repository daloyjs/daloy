import { ImageResponse } from "next/og";

export const alt =
  "Willpower is not a security control: secure defaults beat training, and AI does not fix that.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

/**
 * Post-specific OpenGraph card for the DevSecStation-inspired defaults post.
 * Leads with the thesis so the social preview carries the argument alone.
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
            color: "#a3a3a3",
            fontSize: "22px",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Opinion
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <div
          style={{
            display: "flex",
            color: "#38bdf8",
            fontSize: "26px",
            fontWeight: 600,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Secure defaults beat training
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "52px",
            fontWeight: 800,
            lineHeight: 1.08,
            maxWidth: "1040px",
          }}
        >
          Willpower is not a security control. AI does not fix that either.
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px" }}>
        {[
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
        ].map((stat) => (
          <div
            key={stat.value}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              flex: 1,
              padding: "24px 28px",
              borderRadius: "18px",
              background: "#111827",
              border: "1px solid #1f2937",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "28px",
                fontWeight: 800,
                color: stat.accent,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "20px",
                color: "#d4d4d4",
                lineHeight: 1.25,
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
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
        <div style={{ display: "flex" }}>daloyjs.dev/blog</div>
        <div style={{ display: "flex" }}>
          DevSecStation · SheHacksPurple
        </div>
      </div>
    </div>,
    size
  );
}
