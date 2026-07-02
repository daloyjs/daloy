"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";

import { docsNav, type DocsNavItem } from "./docs-nav";
import { cn } from "../lib/utils";

const FLAT_NAV: DocsNavItem[] = docsNav.flatMap((section) => section.items);

/**
 * Previous / next page footer navigation for docs articles.
 *
 * Derives the reading order from {@link docsNav} (the same order as the
 * sidebar) and renders links to the pages before and after the current one.
 * Renders nothing on paths that are not part of the docs navigation.
 *
 * @returns The pager footer, or `null` off the docs nav.
 */
export function DocsPager() {
  const pathname = usePathname();
  const index = FLAT_NAV.findIndex((item) => item.href === pathname);

  if (index === -1) {
    return null;
  }

  const previous = index > 0 ? FLAT_NAV[index - 1] : null;
  const next = index < FLAT_NAV.length - 1 ? FLAT_NAV[index + 1] : null;

  if (!previous && !next) {
    return null;
  }

  return (
    <nav
      aria-label="Docs pagination"
      className="mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-stretch sm:justify-between"
    >
      {previous ? (
        <PagerLink item={previous} direction="previous" />
      ) : (
        <span aria-hidden className="hidden flex-1 sm:block" />
      )}
      {next ? (
        <PagerLink item={next} direction="next" />
      ) : (
        <span aria-hidden className="hidden flex-1 sm:block" />
      )}
    </nav>
  );
}

function PagerLink({
  item,
  direction,
}: {
  item: DocsNavItem;
  direction: "previous" | "next";
}) {
  const isNext = direction === "next";

  return (
    <Link
      href={item.href}
      rel={isNext ? "next" : "prev"}
      className={cn(
        "group flex flex-1 flex-col gap-1 rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:max-w-[48%]",
        isNext ? "items-end text-end" : "items-start"
      )}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
        {!isNext && <ArrowLeftIcon className="size-3" aria-hidden />}
        {isNext ? "Next" : "Previous"}
        {isNext && <ArrowRightIcon className="size-3" aria-hidden />}
      </span>
      <span className="text-sm font-medium text-foreground group-hover:text-primary">
        {item.title}
      </span>
    </Link>
  );
}
