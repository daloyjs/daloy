import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "DaloyJS — runtime-portable TypeScript web framework",
    template: "%s · DaloyJS",
  },
  description:
    "A runtime-portable TypeScript web framework with built-in contract-first routing, validation, OpenAPI (Hey API), typed client generation, large-scale maintainability, and highly secured by default (pnpm).",
  metadataBase: new URL("https://daloyjs.dev"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased flex flex-col">
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
      </body>
    </html>
  );
}
