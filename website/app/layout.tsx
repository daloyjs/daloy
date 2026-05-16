import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";
import { RouteTransition } from "@/components/route-transition";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { DEFAULT_KEYWORDS, SITE_NAME, SITE_URL } from "@/lib/seo";

const DEFAULT_TITLE = "DaloyJS — runtime-portable TypeScript web framework";
const DEFAULT_DESCRIPTION =
  "DaloyJS is a runtime-portable TypeScript web framework with contract-first routing, Standard Schema validation, OpenAPI 3.1 generation via Hey API, typed clients, core-enforced security guardrails, and first-party security middleware. Run on Node.js, Bun, Deno, Cloudflare Workers, and Vercel Edge.";

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
    icon: "/favicon.ico",
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

const playfairDisplayHeading = Playfair_Display({ subsets: ["latin"], variable: "--font-heading" });

const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-sans" });

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", notoSans.variable, playfairDisplayHeading.variable)}
    >
      <body className="min-h-screen bg-background font-sans antialiased flex flex-col">
        <ThemeProvider>
          <SiteHeader />
          <RouteTransition>{children}</RouteTransition>
          <footer className="border-t py-6 px-6 text-sm text-muted-foreground" style={{ viewTransitionName: "site-footer" }}>
            <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-2">
              <p className="text-center sm:text-left">
                Built with DaloyJS · MIT licensed · Distributed via{" "}
                <a className="underline" href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">
                  pnpm
                </a>
                {" "}· <a className="underline underline-offset-4" href="/about-the-name">About the name</a>
              </p>
              <p className="text-center sm:text-right">
                <a className="underline underline-offset-4" href="mailto:daloyjs@gmail.com">
                  daloyjs@gmail.com
                </a>
                {" "}· © {new Date().getFullYear()} DaloyJS contributors
              </p>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
