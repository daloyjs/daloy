import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans, Playfair_Display } from "next/font/google"
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    default: "DaloyJS — runtime-portable TypeScript web framework",
    template: "%s · DaloyJS",
  },
  description:
    "A runtime-portable TypeScript web framework with built-in contract-first routing, validation, OpenAPI (Hey API), typed client generation, large-scale maintainability, and highly secured by default (pnpm).",
  metadataBase: new URL("https://daloyjs.dev"),
};

const playfairDisplayHeading = Playfair_Display({subsets:['latin'],variable:'--font-heading'});

const notoSans = Noto_Sans({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", notoSans.variable, playfairDisplayHeading.variable)}>
      <body className="min-h-screen bg-background font-sans antialiased flex flex-col">
        <ThemeProvider>
        <SiteHeader />
        <div className="flex-1 flex flex-col">{children}</div>
        <footer className="border-t py-6 px-6 text-sm text-muted-foreground">
          <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-2">
            <p>
              Built with DaloyJS · MIT licensed · Distributed via{" "}
              <a className="underline" href="https://pnpm.io/motivation" target="_blank" rel="noreferrer">
                pnpm
              </a>
            </p>
            <p>© {new Date().getFullYear()} DaloyJS contributors</p>
          </div>
        </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
