import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
  description: "DaloyJS offline fallback page.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function OfflinePage() {
  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16 lg:py-24">
        <div className="flex size-12 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/20 dark:text-sky-300">
          <span className="font-mono text-lg font-semibold">JS</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">You are offline</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            DaloyJS could not reach the network. Previously opened pages may
            still work from your device cache.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-none bg-foreground px-4 text-xs font-semibold tracking-widest text-background uppercase transition-colors hover:bg-foreground/90"
          >
            Home
          </Link>
          <Link
            href="/docs"
            className="inline-flex h-10 items-center justify-center rounded-none border border-border px-4 text-xs font-semibold tracking-widest uppercase transition-colors hover:bg-muted"
          >
            Docs
          </Link>
        </div>
      </section>
    </main>
  );
}
