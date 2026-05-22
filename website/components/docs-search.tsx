"use client";

import * as React from "react";
import type { Route } from "next";
import { addTransitionType, startTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "./ui/command";
import type { DocsSearchSection } from "@/lib/docs-search";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Highlight matching substring(s) in `text` for the given `query`.
 * Returns plain text when there is no query or no match.
 */
function HighlightText({ text, query }: { text: string; query: string }) {
  const needle = query.trim();

  if (!needle) {
    return <>{text}</>;
  }

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const index = lowerText.indexOf(lowerNeedle);

  if (index === -1) {
    return <>{text}</>;
  }

  return (
    <>
      {text.slice(0, index)}
      <span className="font-bold text-foreground">{text.slice(index, index + needle.length)}</span>
      {text.slice(index + needle.length)}
    </>
  );
}

/**
 * Build a filter function that scores items by matching against title
 * (high weight) and the keywords/body blob (lower weight) separately,
 * so exact title matches always surface before keyword-only matches.
 */
function buildDocsFilter(itemMap: Map<string, { title: string; keywords: string }>) {
  return function filterDocsItem(value: string, search: string): number {
    const item = itemMap.get(value);

    if (!item) {
      return 0;
    }

    const needle = search.toLowerCase().trim();

    if (!needle) {
      return 1;
    }

    const titleLower = item.title.toLowerCase();
    const keywordsLower = item.keywords.toLowerCase();
    const tokens = needle.split(/\s+/).filter(Boolean);

    // Title match — prioritised
    if (titleLower === needle) return 1.0;
    if (titleLower.startsWith(needle)) return 0.95;
    if (titleLower.includes(needle)) return 0.85;
    if (tokens.length > 1 && tokens.every((t) => titleLower.includes(t))) return 0.75;

    // Keywords / body match — lower weight
    if (keywordsLower.includes(needle)) return 0.5;
    if (tokens.length > 1 && tokens.every((t) => keywordsLower.includes(t))) return 0.35;

    return 0;
  };
}

export function DocsSearch({ sections }: { sections: DocsSearchSection[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const itemMap = React.useMemo(() => {
    const map = new Map<string, { title: string; keywords: string }>();

    for (const section of sections) {
      for (const item of section.items) {
        map.set(item.href, { title: item.title, keywords: item.keywords });
      }
    }

    return map;
  }, [sections]);

  const filterDocsItem = React.useMemo(() => buildDocsFilter(itemMap), [itemMap]);

  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    setOpen((currentOpen) => !currentOpen);
  });

  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleSelect(href: Route) {
    setOpen(false);
    setSearch("");
    startTransition(() => {
      addTransitionType("nav-forward");
      router.push(href);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 w-full justify-between rounded-xl border border-mist-200/80 bg-mist-50/75 px-4 text-[11px] tracking-[0.22em] text-mist-950 shadow-sm hover:bg-mist-100/70 dark:border-mist-900/70 dark:bg-mist-950/20 dark:text-mist-100 dark:hover:bg-mist-950/35 dim:border-mist-900/60 dim:bg-mist-950/18 dim:text-mist-100 sm:text-xs"
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MagnifyingGlassIcon className="size-4" />
          <span className="truncate">Search documentation</span>
        </span>
        <span className="hidden items-center gap-1 text-[10px] text-mist-900/80 dark:text-mist-100/80 sm:inline-flex">
          <span className="rounded-md border border-mist-300/80 bg-white/75 px-1.5 py-0.5 font-mono tracking-normal text-mist-950 uppercase dark:border-mist-800/80 dark:bg-mist-950/40 dark:text-mist-100">
            Cmd
          </span>
          <span className="rounded-md border border-mist-300/80 bg-white/75 px-1.5 py-0.5 font-mono tracking-normal text-mist-950 uppercase dark:border-mist-800/80 dark:bg-mist-950/40 dark:text-mist-100">
            K
          </span>
        </span>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
        title="Search docs"
        description="Jump between documentation pages."
        className="max-w-2xl rounded-2xl border border-mist-200/80 bg-background/95 p-0 shadow-2xl dark:border-mist-900/70 dim:border-mist-900/60"
      >
        <Command filter={filterDocsItem}>
          <CommandInput
            placeholder="Search docs, topics, and routes..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-104">
            <CommandEmpty>
              No documentation page matched your search.
            </CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.heading} heading={section.heading}>
                {section.items.map((item) => {
                  const active = pathname === item.href;

                  return (
                    <CommandItem
                      key={item.href}
                      value={item.href}
                      onSelect={() => handleSelect(item.href)}
                      className="gap-3 rounded-xl px-4 py-3 data-selected:bg-muted/80"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground">
                          <HighlightText text={item.title} query={search} />
                        </div>
                        <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          <HighlightText text={item.description} query={search} />
                        </div>
                      </div>
                      <CommandShortcut>
                        {active ? "Current" : "Open"}
                      </CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
