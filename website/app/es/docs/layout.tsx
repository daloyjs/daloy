import { DocsToc, DocsTocMobile } from "@/components/docs-toc";
import { SpanishDocsNav } from "@/components/spanish-docs-nav";

const TOC_LABEL = "En esta página";

/**
 * Layout for the Castilian Spanish docs under `/es/docs`. Lighter than the
 * English docs layout: the search, breadcrumb, pager and page footer read the
 * English docs tree, so they stay there; this one lists only the translated
 * pages and links out to the full English docs.
 */
export default function SpanishDocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
      <details className="group mt-6 rounded-lg border px-4 py-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium">
          Documentación en español
        </summary>
        <div className="mt-3">
          <SpanishDocsNav />
        </div>
      </details>

      <div className="flex gap-10 pt-6 pb-8 lg:gap-14 lg:py-12">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-20">
            <SpanishDocsNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <DocsTocMobile label={TOC_LABEL} />
          <article
            data-docs-content
            className="docs-prose max-w-full lg:max-w-[72ch]"
          >
            {children}
          </article>
        </main>
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent scrollbar-gutter-stable overflow-y-auto pe-2 max-block-[calc(100vh-6rem)]">
            <DocsToc label={TOC_LABEL} />
          </div>
        </aside>
      </div>
    </div>
  );
}
