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
import type { DocsSearchItem } from "@/lib/docs-search";
import { useDocsSearchIndex } from "@/lib/docs-search-client";
import { rankDocPages } from "@/lib/docs-ranking";
import { cn } from "@/lib/utils";

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
 * Highlight the query's terms in `text` (case-insensitive, whole query first,
 * then individual tokens of 2+ characters). Plain text when nothing matches.
 */
function HighlightText({ text, query }: { text: string; query: string }) {
  const tokens = [query.trim(), ...query.trim().split(/\s+/)]
    .filter((token) => token.length >= 2)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (tokens.length === 0) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${tokens.join("|")})`, "gi"));

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="font-bold text-foreground">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

/** Maximum number of results shown while a query is active. */
const MAX_RESULTS = 12;
/** Maximum "Jump to" page-title shortcuts shown above the results. */
const MAX_JUMPS = 3;

/**
 * Rank the index for a query, optionally within one section, and split out
 * "Jump to" shortcuts: pages whose title starts with the query, like
 * Fumadocs' page-tree quick action.
 *
 * @param items - Flat search index.
 * @param query - The raw query.
 * @param section - Section filter, or `null` for all sections.
 * @returns Jump shortcuts and ranked results (disjoint).
 */
export function searchDocs(
  items: readonly DocsSearchItem[],
  query: string,
  section: string | null
): { jumps: DocsSearchItem[]; results: DocsSearchItem[] } {
  const pool = section ? items.filter((item) => item.section === section) : items;
  const needle = query.trim().toLowerCase();
  if (!needle) return { jumps: [], results: [] };

  const jumps = pool
    .filter((item) => item.title.toLowerCase().startsWith(needle))
    .slice(0, MAX_JUMPS);
  const jumped = new Set(jumps.map((item) => item.href));
  const results = rankDocPages(pool, query, MAX_RESULTS + jumps.length)
    .map(({ page }) => page)
    .filter((item) => !jumped.has(item.href))
    .slice(0, MAX_RESULTS);

  return { jumps, results };
}

/**
 * Docs search: a Cmd/Ctrl+K command dialog over every docs page.
 *
 * The index is fetched from `/docs/search-index.json` the first time the
 * dialog is opened (or the trigger is hovered or focused), instead of being
 * serialized into every page. Results come from the same ranker as the MCP
 * `search_docs` tool, can be filtered to one sidebar section, and open with
 * "Jump to" shortcuts for pages whose title starts with the query.
 */
export function DocsSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [wanted, setWanted] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [section, setSection] = React.useState<string | null>(null);
  const { sections, items, status } = useDocsSearchIndex(open || wanted);

  const { jumps, results } = React.useMemo(
    () => searchDocs(items, search, section),
    [items, search, section]
  );
  const browsing = search.trim() === "";
  const browseSections = section ? sections.filter((entry) => entry.heading === section) : sections;

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

  const prefetch = () => setWanted(true);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 w-full justify-between rounded-xl border border-mist-200/80 bg-mist-50/75 px-4 text-[11px] tracking-[0.22em] text-mist-950 shadow-sm hover:bg-mist-100/70 sm:text-xs dark:border-mist-900/70 dark:bg-mist-950/20 dark:text-mist-100 dark:hover:bg-mist-950/35 dim:border-mist-900/60 dim:bg-mist-950/18 dim:text-mist-100"
        onClick={() => setOpen(true)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
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
          if (!next) {
            setSearch("");
            setSection(null);
          }
        }}
        title="Search docs"
        description="Jump between documentation pages."
        className="max-w-2xl rounded-2xl border border-mist-200/80 bg-background/95 p-0 shadow-2xl dark:border-mist-900/70 dim:border-mist-900/60"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search docs, topics, and routes…"
            value={search}
            onValueChange={setSearch}
          />
          {sections.length > 0 ? (
            <div
              role="group"
              aria-label="Filter by section"
              className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 scrollbar-thin scrollbar-thumb-border/70 scrollbar-track-transparent"
            >
              {[null, ...sections.map((entry) => entry.heading)].map((heading) => (
                <button
                  key={heading ?? "all"}
                  type="button"
                  aria-pressed={section === heading}
                  onClick={() => setSection(heading)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    section === heading
                      ? "border-foreground/30 bg-muted font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {heading ?? "All"}
                </button>
              ))}
            </div>
          ) : null}
          <CommandList className="max-h-104">
            <CommandEmpty>
              {status === "error"
                ? "Search is unavailable right now. Try again in a moment."
                : status === "ready"
                  ? "No documentation page matched your search."
                  : "Loading the docs index…"}
            </CommandEmpty>
            {browsing ? (
              browseSections.map((entry) => (
                <CommandGroup key={entry.heading} heading={entry.heading}>
                  {entry.items.map((item) => (
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
              <>
                {jumps.length > 0 ? (
                  <CommandGroup heading="Jump to">
                    {jumps.map((item) => (
                      <DocsSearchResult
                        key={item.href}
                        item={item}
                        section={item.section}
                        search={search}
                        active={pathname === item.href}
                        onSelect={handleSelect}
                        compact
                      />
                    ))}
                  </CommandGroup>
                ) : null}
                {results.length > 0 ? (
                  <CommandGroup heading="Results">
                    {results.map((item) => (
                      <DocsSearchResult
                        key={item.href}
                        item={item}
                        section={item.section}
                        search={search}
                        active={pathname === item.href}
                        onSelect={handleSelect}
                      />
                    ))}
                  </CommandGroup>
                ) : null}
              </>
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
 * @param compact - Title-only row (used for "Jump to" shortcuts).
 */
function DocsSearchResult({
  item,
  section,
  search,
  active,
  onSelect,
  compact = false,
}: {
  item: DocsSearchItem;
  section?: string;
  search: string;
  active: boolean;
  onSelect: (href: Route) => void;
  compact?: boolean;
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
        {compact ? null : (
          <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            <HighlightText text={item.description} query={search} />
          </div>
        )}
      </div>
      <CommandShortcut>{active ? "Current" : "Open"}</CommandShortcut>
    </CommandItem>
  );
}
