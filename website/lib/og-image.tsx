import type { ReactNode } from "react";
import { ImageResponse } from "next/og";

import { SITE_NAME } from "@/lib/seo";

export const ogImageSize = {
  width: 1200,
  height: 630,
};

export const ogImageContentType = "image/png";

/** Brand palette used across every Open Graph card. */
export const og = {
  bg: "#05070d",
  bgMid: "#0a1018",
  text: "#f8fafc",
  muted: "#94a3b8",
  faint: "#64748b",
  sky: "#38bdf8",
  skySoft: "#7dd3fc",
  skyDeep: "#0ea5e9",
  skyDim: "rgba(56, 189, 248, 0.12)",
  skyLine: "rgba(56, 189, 248, 0.45)",
  glass: "rgba(15, 23, 42, 0.55)",
  glassBorder: "rgba(148, 163, 184, 0.16)",
  card: "rgba(15, 23, 42, 0.72)",
  cardBorder: "rgba(148, 163, 184, 0.14)",
  font: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
} as const;

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function titleFontSize(title: string): number {
  if (title.length > 90) return 46;
  if (title.length > 70) return 52;
  if (title.length > 48) return 58;
  return 66;
}

/**
 * Short, readable route kicker for the card. Long blog/doc slugs compete with
 * the title in social previews, so deep paths collapse to the section (and a
 * short leaf when it fits).
 */
function formatPathKicker(path: string): string {
  const normalized = path.replace(/\/+$/, "") || "/";
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length === 0) return "/";
  if (parts.length === 1) return `/${parts[0]}`;

  const section = parts[0];
  const leaf = parts[parts.length - 1] ?? "";

  // Title already carries the story; skip long slug tails.
  if (leaf.length > 28) return `/${section}`;

  return `/${section}/${leaf}`;
}

/** Three-wave brand mark used on every OG card. */
export function OgWaveMark({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M 10 22 C 28 6 44 38 62 22"
        fill="none"
        stroke="#bae6fd"
        strokeWidth={3.5}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M 10 36 C 28 20 44 52 62 36"
        fill="none"
        stroke="#38bdf8"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <path
        d="M 10 50 C 28 34 44 66 62 50"
        fill="none"
        stroke="#0284c7"
        strokeWidth={3.5}
        strokeLinecap="round"
        opacity={0.85}
      />
    </svg>
  );
}

/** Wordmark lockup: wave tile + DaloyJS. */
export function OgBrandLockup({
  markSize = 52,
  fontSize = 36,
}: {
  markSize?: number;
  fontSize?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: markSize + 20,
          height: markSize + 20,
          borderRadius: 18,
          background:
            "linear-gradient(145deg, rgba(14, 165, 233, 0.16) 0%, rgba(15, 23, 42, 0.9) 55%, rgba(2, 6, 23, 0.95) 100%)",
          border: `1px solid ${og.skyLine}`,
          boxShadow: "0 0 40px rgba(56, 189, 248, 0.12)",
        }}
      >
        <OgWaveMark size={markSize} />
      </div>
      <div
        style={{
          display: "flex",
          fontSize,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        <span style={{ color: og.text }}>Daloy</span>
        <span style={{ color: og.sky }}>JS</span>
      </div>
    </div>
  );
}

/** Soft pill used for Blog / Docs / Field Report labels. */
export function OgPill({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
        borderRadius: 999,
        background: og.skyDim,
        border: `1px solid ${og.skyLine}`,
        color: og.skySoft,
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 2.4,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Shared atmospheric shell: deep navy base, corner glows, left accent bar,
 * and a faint brand wave watermark. Content is layered above via children.
 */
export function OgShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(145deg, ${og.bg} 0%, ${og.bgMid} 48%, #060910 100%)`,
        color: og.text,
        fontFamily: og.font,
      }}
    >
      {/* Top-right sky glow */}
      <div
        style={{
          position: "absolute",
          top: -180,
          right: -120,
          width: 560,
          height: 560,
          borderRadius: 999,
          background:
            "radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, rgba(56, 189, 248, 0.06) 42%, transparent 70%)",
          display: "flex",
        }}
      />
      {/* Bottom-left cool glow */}
      <div
        style={{
          position: "absolute",
          bottom: -220,
          left: -140,
          width: 520,
          height: 520,
          borderRadius: 999,
          background:
            "radial-gradient(circle, rgba(14, 165, 233, 0.12) 0%, transparent 68%)",
          display: "flex",
        }}
      />
      {/* Soft vignette */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          background:
            "radial-gradient(ellipse at 50% 120%, transparent 40%, rgba(0, 0, 0, 0.45) 100%)",
          display: "flex",
        }}
      />
      {/* Left brand accent rail */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          background: `linear-gradient(180deg, ${og.skySoft} 0%, ${og.sky} 40%, ${og.skyDeep} 100%)`,
          display: "flex",
        }}
      />
      {/* Watermark wave, bottom-right */}
      <div
        style={{
          position: "absolute",
          right: 48,
          bottom: 36,
          opacity: 0.07,
          display: "flex",
        }}
      >
        <OgWaveMark size={220} />
      </div>
      {/* Inner content frame */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "56px 64px 48px 72px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function OgHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
      }}
    >
      <OgBrandLockup />
      <OgPill>{label}</OgPill>
    </div>
  );
}

export function OgFooter({
  left = SITE_NAME,
  right = "daloyjs.dev",
}: {
  left?: string;
  right?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        paddingTop: 22,
        borderTop: `1px solid ${og.glassBorder}`,
        color: og.muted,
        fontSize: 22,
        fontWeight: 500,
        letterSpacing: "0.01em",
      }}
    >
      <span style={{ display: "flex" }}>{left}</span>
      <span style={{ display: "flex", color: og.skySoft }}>{right}</span>
    </div>
  );
}

/** Thin sky gradient bar used under titles for visual finish. */
export function OgAccentBar({ width = 96 }: { width?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width,
        height: 4,
        borderRadius: 999,
        background: `linear-gradient(90deg, ${og.sky} 0%, ${og.skyDeep} 55%, transparent 100%)`,
        marginTop: 4,
      }}
    />
  );
}

type PageOgImageInput = {
  title: string;
  label: string;
  path: string;
};

/**
 * Default dark brand card for docs and blog pages: atmospheric shell,
 * brand lockup, label pill, path kicker, title only (no body description).
 */
export function renderPageOgImage(input: PageOgImageInput): ImageResponse {
  const title = clampText(input.title, 112);
  const fontSize = titleFontSize(title);
  const kicker = formatPathKicker(input.path);

  return new ImageResponse(
    (
      <OgShell>
        <OgHeader label={input.label} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            maxWidth: 1040,
            marginTop: 8,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: og.sky,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 28,
                height: 2,
                borderRadius: 999,
                background: og.sky,
                opacity: 0.9,
              }}
            />
            {kicker}
          </div>
          <div
            style={{
              display: "flex",
              fontSize,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              color: og.text,
            }}
          >
            {title}
          </div>
          <OgAccentBar width={112} />
        </div>

        <OgFooter />
      </OgShell>
    ),
    ogImageSize,
  );
}

/**
 * Homepage Open Graph card: larger brand lockup and the product headline.
 */
export function renderHomeOgImage(input: {
  title: string;
}): ImageResponse {
  const title = clampText(input.title, 120);

  return new ImageResponse(
    (
      <OgShell>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <OgBrandLockup markSize={64} fontSize={48} />
          <OgPill>Open Source</OgPill>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: title.length > 70 ? 48 : 56,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: og.text,
            }}
          >
            {title}
          </div>
          <OgAccentBar width={128} />
        </div>

        <OgFooter left="Secure by default · Zero runtime deps" />
      </OgShell>
    ),
    ogImageSize,
  );
}

export type OgStat = {
  value: string;
  label: string;
  accent?: string;
};

/**
 * Stats-forward card used by field-report blog posts: same shell and chrome
 * as the default card, plus three metric tiles under the headline.
 */
export function renderStatsOgImage(input: {
  label: string;
  kicker: string;
  title: string;
  stats: OgStat[];
  footerLeft?: string;
  footerRight?: string;
}): ImageResponse {
  const title = clampText(input.title, 100);
  const fontSize = title.length > 70 ? 42 : title.length > 50 ? 48 : 54;

  return new ImageResponse(
    (
      <OgShell>
        <OgHeader label={input.label} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            maxWidth: 1040,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: og.sky,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 2.2,
              textTransform: "uppercase",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 28,
                height: 2,
                borderRadius: 999,
                background: og.sky,
                opacity: 0.85,
              }}
            />
            {input.kicker}
          </div>
          <div
            style={{
              display: "flex",
              fontSize,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              color: og.text,
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, width: "100%" }}>
          {input.stats.map((stat) => (
            <div
              key={stat.value}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                flex: 1,
                padding: "22px 24px",
                borderRadius: 20,
                background: og.card,
                border: `1px solid ${og.cardBorder}`,
                boxShadow: "0 12px 40px rgba(0, 0, 0, 0.28)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: stat.value.length > 12 ? 28 : 40,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  color: stat.accent ?? og.sky,
                  lineHeight: 1.05,
                }}
              >
                {stat.value}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 18,
                  color: og.muted,
                  lineHeight: 1.3,
                  fontWeight: 500,
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        <OgFooter
          left={input.footerLeft ?? "daloyjs.dev/blog"}
          right={input.footerRight ?? "daloyjs.dev"}
        />
      </OgShell>
    ),
    ogImageSize,
  );
}

/**
 * Release-style card: oversized version number, short headline, brand chrome.
 */
export function renderReleaseOgImage(input: {
  version: string;
  title: string;
  footer?: string;
}): ImageResponse {
  return new ImageResponse(
    (
      <OgShell>
        <OgHeader label="Release" />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 120,
              fontWeight: 800,
              letterSpacing: "-0.05em",
              lineHeight: 0.95,
              color: og.skySoft,
            }}
          >
            {input.version}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              color: og.text,
              maxWidth: 920,
            }}
          >
            {input.title}
          </div>
          <OgAccentBar width={112} />
        </div>

        <OgFooter
          left={input.footer ?? "Public API frozen · semver from here"}
        />
      </OgShell>
    ),
    ogImageSize,
  );
}
