"use client";

import * as React from "react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { REPO_BRANCH, REPO_URL, type DocsPageMeta } from "@/lib/docs-page-meta-shared";

/**
 * Format an ISO date in the reader's locale and timezone. Runs after mount
 * only, so the server HTML and first client render agree.
 */
function useLocalDate(iso: string | undefined): string | null {
  const [text, setText] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!iso) {
      queueMicrotask(() => setText(null));
      return;
    }
    const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(iso));
    queueMicrotask(() => setText(formatted));
  }, [iso]);

  return text;
}

/**
 * Footer row under each docs article: "Edit this page on GitHub" and the
 * git-derived "Last updated" date. Renders nothing for routes without a known
 * source file.
 *
 * @param props.meta - Route → source/date map from `getDocsPageMeta()`.
 */
export function DocsPageFooter({ meta }: { meta: Record<string, DocsPageMeta> }) {
  const pathname = usePathname();
  const entry = meta[pathname.replace(/\/+$/, "") || "/docs"];
  const date = useLocalDate(entry?.lastModified);

  if (!entry?.source) {
    return null;
  }

  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground">
      <a
        href={`${REPO_URL}/edit/${REPO_BRANCH}/${entry.source}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <PencilSimpleIcon aria-hidden className="size-4" />
        Edit this page on GitHub
      </a>
      {entry.lastModified ? (
        <p className="m-0">
          Last updated{" "}
          <time dateTime={entry.lastModified} suppressHydrationWarning>
            {date ?? entry.lastModified.slice(0, 10)}
          </time>
        </p>
      ) : null}
    </div>
  );
}
