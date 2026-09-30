import { DocsBreadcrumb } from "@/components/docs-breadcrumb";
import { DocsNavDisclosure } from "@/components/docs-nav-disclosure";
import { DocsPageCopyButton } from "@/components/docs-page-copy-button";
import { DocsPager } from "@/components/docs-pager";
import { DocsLinkPreview } from "@/components/docs-link-preview";
import { DocsPageFooter } from "@/components/docs-page-footer";
import { DocsToc, DocsTocMobile } from "@/components/docs-toc";
import { getDocsPageMeta } from "@/lib/docs-page-meta";
import { DocsSearch } from "../../components/docs-search";
import { DocsSidebar } from "../../components/docs-sidebar";

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pageMeta = await getDocsPageMeta();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
      <div className="pt-6 lg:pt-8">
        <div className="flex items-start justify-between gap-3">
          <div className="w-full max-w-xl">
            <DocsSearch />
          </div>
          <DocsPageCopyButton meta={pageMeta} />
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
            className="sticky top-20 scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent scrollbar-gutter-stable overflow-y-auto pe-2 max-block-[calc(100vh-6rem)]"
          >
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <DocsTocMobile />
          <DocsBreadcrumb />
          <article
            data-docs-content
            className="docs-prose max-w-full lg:max-w-[72ch]"
          >
            {children}
          </article>
          <DocsLinkPreview />
          <div className="max-w-full lg:max-w-[72ch]">
            <DocsPageFooter meta={pageMeta} />
            <DocsPager />
          </div>
        </main>
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent scrollbar-gutter-stable overflow-y-auto pe-2 max-block-[calc(100vh-6rem)]">
            <DocsToc />
          </div>
        </aside>
      </div>
    </div>
  );
}
