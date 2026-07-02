"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretRightIcon } from "@phosphor-icons/react";

import { docsNav } from "./docs-nav";

/**
 * Breadcrumb trail ("Docs / Section / Page") shown above docs articles.
 *
 * Resolves the current page's section and title from {@link docsNav}. The
 * current page is plain text (`aria-current="page"`); ancestors link back.
 * Renders nothing on the docs index or off-nav paths.
 *
 * @returns The breadcrumb navigation, or `null` when there is no trail.
 */
export function DocsBreadcrumb() {
  const pathname = usePathname();

  if (pathname === "/docs") {
    return null;
  }

  const section = docsNav.find((candidate) =>
    candidate.items.some((item) => item.href === pathname)
  );
  const item = section?.items.find((entry) => entry.href === pathname);

  if (!section || !item) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <li>
          <Link
            href="/docs"
            className="transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Docs
          </Link>
        </li>
        <li aria-hidden>
          <CaretRightIcon className="size-3" />
        </li>
        <li className="tracking-wide">{section.title}</li>
        <li aria-hidden>
          <CaretRightIcon className="size-3" />
        </li>
        <li aria-current="page" className="font-medium text-foreground">
          {item.title}
        </li>
      </ol>
    </nav>
  );
}
