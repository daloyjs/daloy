import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SiteLocaleProvider } from "@/components/site-locale";
import { ThemeProvider } from "@/components/theme-provider";
import { ReadingProgress } from "@/components/reading-progress";
import { BackToTop } from "@/components/back-to-top";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { cn } from "@/lib/utils";
import { HTML_DIR, HTML_LANG, LOCALE_HEADER, parseLocaleHeader, type SiteLocale } from "@/lib/i18n";
import {
  DEFAULT_KEYWORDS,
  HOME_DESCRIPTION,
  HOME_TITLE,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

// instant = false: kept on purpose. Nonce-based CSP: this layout reads
// headers() for the per-request x-nonce that proxy.ts mints, so next-themes
// and analytics scripts satisfy script-src 'nonce-…' without 'unsafe-inline'.
// A nonce cannot be baked into a prerendered shell (Next.js: nonce CSP
// requires dynamic rendering).
export const instant = false;

const DEFAULT_TITLE = `${SITE_NAME} - ${HOME_TITLE}`;

const SKIP_LINK: Record<SiteLocale, string> = {
  en: "Skip to content",
  es: "Saltar al contenido",
  zh: "跳到主要内容",
  fr: "Aller au contenu",
  pt: "Pular para o conteúdo",
  ar: "انتقل إلى المحتوى",
};
const DEFAULT_DESCRIPTION = HOME_DESCRIPTION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  generator: "Next.js",
  keywords: DEFAULT_KEYWORDS,
  authors: [{ name: "DaloyJS contributors", url: SITE_URL }],
  creator: "DaloyJS contributors",
  publisher: "DaloyJS",
  category: "technology",
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "DaloyJS blog" }] },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: DEFAULT_TITLE,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/assets/logo.svg", type: "image/svg+xml" },
      { url: "/assets/favicon.ico", sizes: "any" },
      { url: "/assets/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/assets/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/assets/favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/assets/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/assets/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      {
        url: "/assets/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: ["/assets/favicon.ico"],
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The CSP nonce is minted per request in proxy.ts and forwarded on `x-nonce`.
  // Reading it here (a dynamic API) also opts the tree into dynamic rendering,
  // which nonce-based CSP requires. It is stamped onto the inline scripts we
  // control — next-themes' anti-FOUC script and the analytics loader — so they
  // satisfy `script-src 'nonce-…'` without `'unsafe-inline'`.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  // Locale from proxy.ts (derived from the pathname, never client-supplied).
  // Cross-locale links are full document loads, so this stays accurate for
  // the life of the document (see lib/i18n.ts).
  const locale = parseLocaleHeader(requestHeaders.get(LOCALE_HEADER));

  return (
    <html
      lang={HTML_LANG[locale]}
      dir={HTML_DIR[locale]}
      suppressHydrationWarning
      className={cn(
        "antialiased",
        "font-sans",
        inter.variable,
        geistMono.variable
      )}
    >
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        <ThemeProvider nonce={nonce}>
          <SiteLocaleProvider locale={locale}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-lg focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          >
            {SKIP_LINK[locale]}
          </a>
          <ReadingProgress />
          <SiteHeader locale={locale} />
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
            {children}
          </div>
          <SiteFooter locale={locale} />
          <BackToTop />
          </SiteLocaleProvider>
        </ThemeProvider>
        <SpeedInsights />
        <Analytics />
        <PwaServiceWorker />
      </body>
      <GoogleAnalytics gaId="G-DSBFBZT7RQ" nonce={nonce} />
    </html>
  );
}
