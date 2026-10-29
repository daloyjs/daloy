import { DocsToc, DocsTocMobile } from "@/components/docs-toc";
import { TRANSLATED_DOCS_COPY, TranslatedDocsNav } from "@/components/translated-docs-nav";
import { resolveLocale } from "@/lib/i18n-route";

/**
 * Layout for a translated docs section (`/es/docs`, `/zh/docs`). Lighter
 * than the English docs layout: the search, breadcrumb, pager and page
 * footer read the English docs tree, so they stay there; this one lists only
 * the translated pages and links out to the full English docs.
 */
export default async function TranslatedDocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = await resolveLocale(params);
  const copy = TRANSLATED_DOCS_COPY[locale];

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
      <details className="group mt-6 rounded-lg border px-4 py-3 lg:hidden">
        <summary className="cursor-pointer text-sm font-medium">{copy.indexTitle}</summary>
        <div className="mt-3">
          <TranslatedDocsNav locale={locale} />
        </div>
      </details>

      <div className="flex gap-10 pt-6 pb-8 lg:gap-14 lg:py-12">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-20">
            <TranslatedDocsNav locale={locale} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <DocsTocMobile label={copy.tocLabel} />
          <article data-docs-content className="docs-prose max-w-full lg:max-w-[72ch]">
            {children}
          </article>
        </main>
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-20 scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent scrollbar-gutter-stable overflow-y-auto pe-2 max-block-[calc(100vh-6rem)]">
            <DocsToc label={copy.tocLabel} />
          </div>
        </aside>
      </div>
    </div>
  );
}
