import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Noto_Sans, Playfair_Display } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { LogoLockup } from "@/components/daloyjs-logo";
import { ThemeProvider } from "@/components/theme-provider";
import { ReadingProgress } from "@/components/reading-progress";
import { BackToTop } from "@/components/back-to-top";
import { PwaServiceWorker } from "@/components/pwa-service-worker";
import { cn } from "@/lib/utils";
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

const DEFAULT_TITLE = `${SITE_NAME} - ${HOME_TITLE}`;
const DEFAULT_DESCRIPTION = HOME_DESCRIPTION;
const COPYRIGHT_YEAR = 2026;

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

const playfairDisplayHeading = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading",
});

const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-sans" });

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The CSP nonce is minted per request in proxy.ts and forwarded on `x-nonce`.
  // Reading it here (a dynamic API) also opts the tree into dynamic rendering,
  // which nonce-based CSP requires. It is stamped onto the inline scripts we
  // control — next-themes' anti-FOUC script and the analytics loader — so they
  // satisfy `script-src 'nonce-…'` without `'unsafe-inline'`.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        "font-sans",
        notoSans.variable,
        playfairDisplayHeading.variable
      )}
    >
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        <ThemeProvider nonce={nonce}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-lg focus:border focus:border-border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          >
            Skip to content
          </a>
          <ReadingProgress />
          <SiteHeader />
          <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
            {children}
          </div>
          <footer className="border-t px-6 py-6 text-sm text-muted-foreground">
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
                <Link href="/" aria-label="DaloyJS Home">
                  <LogoLockup className="h-6 w-auto transition-opacity hover:opacity-80" />
                </Link>
                <span className="hidden text-border sm:inline-block">|</span>
                <p className="text-center sm:text-left">
                  MIT licensed · Distributed via{" "}
                  <a
                    className="underline"
                    href="https://pnpm.io/motivation"
                    target="_blank"
                    rel="noreferrer"
                  >
                    pnpm
                  </a>{" "}
                  ·{" "}
                  <Link className="underline underline-offset-4" href="/blog">
                    Blog
                  </Link>{" "}
                  ·{" "}
                  <Link
                    className="underline underline-offset-4"
                    href="/about-the-name"
                  >
                    About the name
                  </Link>
                </p>
              </div>
              <p className="text-center sm:text-right">
                <a
                  className="underline underline-offset-4"
                  href="mailto:daloyjs@gmail.com"
                >
                  daloyjs@gmail.com
                </a>{" "}
                · © {COPYRIGHT_YEAR} DaloyJS contributors
              </p>
            </div>
          </footer>
          <BackToTop />
        </ThemeProvider>
        <SpeedInsights />
        <Analytics />
        <PwaServiceWorker />
      </body>
      <GoogleAnalytics gaId="G-DSBFBZT7RQ" nonce={nonce} />
    </html>
  );
}
