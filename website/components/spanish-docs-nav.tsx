import { SpanishDocsNavList } from "@/components/spanish-docs-nav-list";
import { getSpanishMdxDocs } from "@/lib/mdx/content";
import { spanishPath, TRANSLATED_PATHS } from "@/lib/i18n";

/** Spanish docs in reading order: the order of `TRANSLATED_PATHS`. */
async function orderedSpanishDocs() {
  const docs = await getSpanishMdxDocs();
  const order = TRANSLATED_PATHS.filter((path) => path.startsWith("/docs/")).map(spanishPath);
  return docs
    .filter((doc) => order.includes(doc.route))
    .sort((a, b) => order.indexOf(a.route) - order.indexOf(b.route));
}

/**
 * Sidebar for the Spanish docs: the translated pages, then a link out to the
 * full English docs (a plain `<a>`: crossing locales reloads the document).
 */
export async function SpanishDocsNav() {
  const docs = await orderedSpanishDocs();

  return (
    <nav aria-label="Documentación en español" className="flex flex-col gap-1 text-sm">
      <SpanishDocsNavList
        items={docs.map((doc) => ({ href: doc.route, title: doc.frontmatter.title }))}
      />
      <a
        href="/docs"
        hrefLang="en"
        className="mt-3 border-t px-2.5 pt-3 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Toda la documentación (en inglés) →
      </a>
    </nav>
  );
}

/**
 * The Spanish docs pages as `{ href, title, description }`, in reading order,
 * for the `/es/docs` index cards.
 *
 * @returns One entry per translated docs page.
 */
export async function spanishDocsIndex(): Promise<
  Array<{ href: string; title: string; description: string }>
> {
  return (await orderedSpanishDocs()).map((doc) => ({
    href: doc.route,
    title: doc.frontmatter.title,
    description: doc.frontmatter.description,
  }));
}
