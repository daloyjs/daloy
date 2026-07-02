"use client";

import * as React from "react";
import type { Route } from "next";
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
import type { DocsSearchItem, DocsSearchSection } from "@/lib/docs-search";

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
      <span className="font-bold text-foreground">
        {text.slice(index, index + needle.length)}
      </span>
      {text.slice(index + needle.length)}
    </>
  );
}

/** Maximum number of results shown while a query is active. */
const MAX_RESULTS = 12;

/**
 * Lowercase and strip punctuation so "rate limit" matches "Rate-limit"
 * and "problem+json" matches "problem json".
 */
function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type ScoredResult = {
  item: DocsSearchItem;
  section: string;
  score: number;
};

/**
 * Score one docs page against a normalized query.
 *
 * Title matches always outrank description matches, which outrank matches
 * that only occur in the keywords/body blob, so the page *about* a topic
 * surfaces above the many pages that merely mention it.
 *
 * @param item - The searchable docs page.
 * @param needle - The normalized query string.
 * @param tokens - The query split into normalized tokens.
 * @returns A relevance score in (0, 1], or 0 for no match.
 */
function scoreDocsItem(
  item: DocsSearchItem,
  needle: string,
  tokens: string[]
): number {
  const title = normalize(item.title);

  if (title === needle) return 1;
  if (title.startsWith(needle)) return 0.95;
  if (title.includes(needle)) return 0.85;
  if (tokens.length > 1 && tokens.every((t) => title.includes(t))) return 0.75;

  const description = normalize(item.description);

  if (description.includes(needle)) return 0.6;
  if (tokens.length > 1 && tokens.every((t) => description.includes(t)))
    return 0.5;

  const keywords = normalize(item.keywords);

  if (keywords.includes(needle)) return 0.4;
  if (tokens.length > 1 && tokens.every((t) => keywords.includes(t)))
    return 0.3;

  return 0;
}

export function DocsSearch({ sections }: { sections: DocsSearchSection[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // With a query active we do the filtering, ranking, and capping ourselves
  // (cmdk's built-in sort proved unreliable across groups); `null` means
  // browse mode, which renders the full grouped navigation.
  const results = React.useMemo<ScoredResult[] | null>(() => {
    const needle = normalize(search);

    if (!needle) {
      return null;
    }

    const tokens = needle.split(" ").filter(Boolean);
    const scored: ScoredResult[] = [];

    for (const section of sections) {
      for (const item of section.items) {
        const score = scoreDocsItem(item, needle, tokens);

        if (score > 0) {
          scored.push({ item, section: section.heading, score });
        }
      }
    }

    // Stable sort: ties keep sidebar (reading) order.
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
  }, [sections, search]);

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
    router.push(href);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 w-full justify-between rounded-xl border border-mist-200/80 bg-mist-50/75 px-4 text-[11px] tracking-[0.22em] text-mist-950 shadow-sm hover:bg-mist-100/70 sm:text-xs dark:border-mist-900/70 dark:bg-mist-950/20 dark:text-mist-100 dark:hover:bg-mist-950/35 dim:border-mist-900/60 dim:bg-mist-950/18 dim:text-mist-100"
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MagnifyingGlassIcon className="size-4" />
          <span className="truncate">Search documentation</span>
        </span>
        <span className="hidden items-center gap-1 text-[10px] text-mist-900/80 sm:inline-flex dark:text-mist-100/80">
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
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search docs, topics, and routes..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-104">
            <CommandEmpty>
              No documentation page matched your search.
            </CommandEmpty>
            {results === null ? (
              sections.map((section) => (
                <CommandGroup key={section.heading} heading={section.heading}>
                  {section.items.map((item) => (
                    <DocsSearchResult
                      key={item.href}
                      item={item}
                      search={search}
                      active={pathname === item.href}
                      onSelect={handleSelect}
                    />
                  ))}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup heading="Results">
                {results.map(({ item, section }) => (
                  <DocsSearchResult
                    key={item.href}
                    item={item}
                    section={section}
                    search={search}
                    active={pathname === item.href}
                    onSelect={handleSelect}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

/**
 * A single docs page row inside the search dialog.
 *
 * @param item - The docs page to render.
 * @param section - Optional section name, shown when results are flattened.
 * @param search - The current query, used to highlight matches.
 * @param active - Whether this row is the page currently being read.
 * @param onSelect - Called with the page href when the row is chosen.
 */
function DocsSearchResult({
  item,
  section,
  search,
  active,
  onSelect,
}: {
  item: DocsSearchItem;
  section?: string;
  search: string;
  active: boolean;
  onSelect: (href: Route) => void;
}) {
  return (
    <CommandItem
      value={item.href}
      onSelect={() => onSelect(item.href)}
      className="gap-3 rounded-xl px-4 py-3 data-selected:bg-muted/80"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-foreground">
            <HighlightText text={item.title} query={search} />
          </span>
          {section ? (
            <span className="shrink-0 text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
              {section}
            </span>
          ) : null}
        </div>
        <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
          <HighlightText text={item.description} query={search} />
        </div>
      </div>
      <CommandShortcut>{active ? "Current" : "Open"}</CommandShortcut>
    </CommandItem>
  );
}
