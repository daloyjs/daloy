import { getDocsSearchSections } from "@/lib/docs-search"
import { DocsPageCopyButton } from "@/components/docs-page-copy-button"
import { DocsSearch } from "../../components/docs-search"
import { DocsSidebar } from "../../components/docs-sidebar"

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const searchSections = await getDocsSearchSections()

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
      <div className="pt-6 lg:pt-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="w-full max-w-xl">
            {/* <DocsSearch sections={searchSections} /> */}
          </div>
          <DocsPageCopyButton />
        </div>
      </div>

      <div className="py-6 lg:hidden">
        <details className="docs-nav-disclosure overflow-hidden rounded-xl border border-border bg-background/95 shadow-sm backdrop-blur">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            Browse docs
          </summary>

          <div className="docs-nav-disclosure__panel border-t border-border px-4 py-4">
            <DocsSidebar />
          </div>
        </details>
      </div>

      <div className="flex gap-10 pb-8 lg:gap-14 lg:py-12">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <article
            data-docs-content
            className="docs-prose max-w-full lg:max-w-[72ch]"
          >
            {children}
          </article>
        </main>
      </div>
    </div>
  )
}
