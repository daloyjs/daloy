import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans, Playfair_Display } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { RouteTransition } from "@/components/route-transition";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { DEFAULT_KEYWORDS, SITE_NAME, SITE_URL } from "@/lib/seo";
import { GoogleAnalytics } from "@next/third-parties/google";

const DEFAULT_TITLE =
  "DaloyJS — the runtime-portable framework for a Zero-Trust supply chain";
const DEFAULT_DESCRIPTION =
  "DaloyJS is a contract-first TypeScript web framework with blocked install scripts, SHA-pinned CI actions, and OIDC provenance — runtime-portable across Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge. Typed end-to-end with Standard Schema validation, OpenAPI 3.1, and Hey API typed clients.";
const COPYRIGHT_YEAR = 2026;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
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

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        notoSans.variable,
        playfairDisplayHeading.variable
      )}
    >
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        <ThemeProvider>
          <SiteHeader />
          <RouteTransition>{children}</RouteTransition>
          <footer
            className="border-t px-6 py-6 text-sm text-muted-foreground"
            style={{ viewTransitionName: "site-footer" }}
          >
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 sm:flex-row">
              <p className="text-center sm:text-left">
                Built with DaloyJS · MIT licensed · Distributed via{" "}
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
        </ThemeProvider>
      </body>
      <GoogleAnalytics gaId="G-DSBFBZT7RQ" />
    </html>
  );
}
