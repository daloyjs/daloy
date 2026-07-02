import { getDocsSearchSections } from "@/lib/docs-search";
import { DocsBreadcrumb } from "@/components/docs-breadcrumb";
import { DocsNavDisclosure } from "@/components/docs-nav-disclosure";
import { DocsPageCopyButton } from "@/components/docs-page-copy-button";
import { DocsPager } from "@/components/docs-pager";
import { DocsToc } from "@/components/docs-toc";
import { DocsSearch } from "../../components/docs-search";
import { DocsSidebar } from "../../components/docs-sidebar";

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const searchSections = await getDocsSearchSections();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
      <div className="pt-6 lg:pt-8">
        <div className="flex items-start justify-between gap-3">
          <div className="w-full max-w-xl">
            <DocsSearch sections={searchSections} />
          </div>
          <DocsPageCopyButton />
        </div>
      </div>

      <div className="py-6 lg:hidden">
        <DocsNavDisclosure>
          <DocsSidebar />
        </DocsNavDisclosure>
      </div>

      <div className="flex gap-10 pb-8 lg:gap-14 lg:py-12">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div
            data-sidebar-scroll
            className="sticky top-20 max-block-[calc(100vh-6rem)] overflow-y-auto pe-2 scrollbar-gutter-stable scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent"
          >
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <DocsBreadcrumb />
          <article
            data-docs-content
            className="docs-prose max-w-full lg:max-w-[72ch]"
          >
            {children}
          </article>
          <div className="max-w-full lg:max-w-[72ch]">
            <DocsPager />
          </div>
        </main>
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 max-block-[calc(100vh-6rem)] overflow-y-auto pe-2 scrollbar-gutter-stable scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent">
            <DocsToc />
          </div>
        </aside>
      </div>
    </div>
  );
}
