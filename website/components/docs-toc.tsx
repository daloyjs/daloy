"use client";

import * as React from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";

import { cn } from "../lib/utils";

type TocEntry = {
  id: string;
  text: string;
  level: 2 | 3;
  /** The heading itself. Ids are not unique across the document (see below). */
  element: HTMLHeadingElement;
};

/**
 * Whether an element is actually rendered.
 *
 * With `cacheComponents`, Next.js keeps previously visited pages mounted but
 * hidden (React `<Activity>` sets `display: none !important` on them) inside
 * the same docs article. Their headings are still in the DOM, and their ids
 * can repeat on the visible page (`#next`, `#install`), so every lookup here
 * must skip hidden subtrees instead of trusting `getElementById`.
 *
 * @param element - The element to test.
 * @returns `true` when the element and its ancestors are displayed.
 */
export function isRendered(element: Element): boolean {
  if (typeof (element as HTMLElement).checkVisibility === "function") {
    return (element as HTMLElement).checkVisibility();
  }
  // Fallback for environments without checkVisibility (and tests): look for
  // an inline display:none on the element or an ancestor.
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (/display:\s*none/i.test(node.getAttribute("style") ?? "")) return false;
  }
  return true;
}

/**
 * Collect the visible `h2[id]` / `h3[id]` headings of the current docs article.
 *
 * Read-only: the article subtree may not have hydrated yet, and mutating it
 * (e.g. injecting anchor elements) causes hydration text mismatches. The
 * hover "#" affordance is drawn with CSS (`::after`) instead, and
 * {@link handleHeadingClick} makes it clickable. Headings of hidden, cached
 * pages are skipped (see {@link isRendered}).
 *
 * @param article - The rendered docs article element.
 * @returns The table-of-contents entries in document order.
 */
export function collectHeadings(article: ParentNode): TocEntry[] {
  const headings = article.querySelectorAll<HTMLHeadingElement>("h2[id], h3[id]");

  return Array.from(headings)
    .filter(isRendered)
    .map((heading) => ({
      id: heading.id,
      text: heading.textContent?.trim() ?? heading.id,
      level: heading.tagName === "H2" ? (2 as const) : (3 as const),
      element: heading,
    }));
}

/**
 * Jump to a heading and record it in the URL, like a native `#anchor` link,
 * but targeting the given element rather than the first element in the
 * document with that id (which may belong to a hidden, cached page).
 * `scrollIntoView` honors the heading's `scroll-margin-top`.
 *
 * @param heading - The visible heading to show.
 */
function jumpToHeading(heading: HTMLElement) {
  heading.scrollIntoView({ block: "start" });
  if (window.location.hash !== `#${heading.id}`) {
    window.history.pushState(window.history.state, "", `#${heading.id}`);
  }
}

/**
 * Delegated click handler that turns the CSS-drawn "#" after each heading
 * into a deep link: clicks landing past the heading's text (i.e. on the
 * `::after` pseudo-element) jump to the heading and set the URL hash. Clicks
 * on the text itself are ignored so selecting or copying heading text never
 * jumps the page.
 *
 * @param event - The click event from the docs article.
 */
function handleHeadingClick(event: MouseEvent) {
  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  const heading = target.closest<HTMLHeadingElement>("h2[id], h3[id]");

  if (!heading) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(heading);

  if (event.clientX <= range.getBoundingClientRect().right) {
    return;
  }

  jumpToHeading(heading);
}

/**
 * Shared state for the desktop TOC and the mobile "On this page" bar: the
 * article's h2/h3 entries and the id of the section currently in view.
 *
 * The active section is the last heading whose top has scrolled past its own
 * `scroll-margin-top` (the sticky-header allowance headings already declare),
 * so the spy line always matches where an anchor jump lands.
 *
 * @param wireHeadingLinks - Attach the delegated "#" deep-link handler. Only
 *   one mounted consumer should pass `true`.
 * @returns The TOC entries and the active heading id.
 */
function useDocsToc(wireHeadingLinks: boolean): { entries: TocEntry[]; activeId: string | null } {
  const pathname = usePathname();
  const [entries, setEntries] = React.useState<TocEntry[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Deferred a tick so we read the article DOM after the commit instead of
    // setting state synchronously inside the effect. queueMicrotask (not
    // requestAnimationFrame) so it also runs in background tabs, where rAF
    // is suspended.
    let cancelled = false;
    let article: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let scheduled = false;

    const refresh = () => {
      scheduled = false;
      if (cancelled || !article) return;
      setEntries(collectHeadings(article));
    };

    queueMicrotask(() => {
      if (cancelled) return;

      article = document.querySelector<HTMLElement>("[data-docs-content]");
      if (!article) {
        setEntries([]);
        return;
      }
      if (wireHeadingLinks) article.addEventListener("click", handleHeadingClick);
      refresh();
      // Cached pages are shown/hidden by toggling an inline style on the
      // article's top-level children (and new pages add children), so watch
      // exactly that and re-read the visible headings when it changes.
      observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(refresh);
      });
      observer.observe(article, { childList: true, attributes: true, attributeFilter: ["style"], subtree: false });
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (wireHeadingLinks) article?.removeEventListener("click", handleHeadingClick);
    };
  }, [pathname, wireHeadingLinks]);

  React.useEffect(() => {
    if (entries.length === 0) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    // The collected elements, not getElementById: a hidden cached page can
    // hold an earlier element with the same id.
    const elements = entries.map((entry) => entry.element);
    // scroll-mt-24 = 96px today; read it so a CSS change cannot desync the spy.
    const offset =
      (elements[0] ? Number.parseFloat(getComputedStyle(elements[0]).scrollMarginTop) || 96 : 96) + 8;

    const update = () => {
      frame = 0;
      if (cancelled) return;
      let current: string | null = entries[0]?.id ?? null;

      for (const el of elements) {
        if (el.getBoundingClientRect().top <= offset) {
          current = el.id;
        } else {
          break;
        }
      }

      // At the very bottom the last short sections can never reach the
      // offset line; treat the final heading as active there.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = elements.at(-1)?.id ?? current;
      }

      setActiveId(current);
    };

    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };

    // Initial highlight via microtask (rAF is suspended in background tabs).
    queueMicrotask(update);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      cancelled = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [entries]);

  return { entries, activeId };
}

function TocList({ entries, activeId, onNavigate }: { entries: TocEntry[]; activeId: string | null; onNavigate?: () => void }) {
  return (
    <ul className="mt-3 space-y-1 border-s border-border/70">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={(event) => {
              // Plain clicks jump to this exact heading; the native fragment
              // lookup could land on a same-id heading of a hidden cached page.
              // Modifier clicks (new tab, etc.) keep the browser default.
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              jumpToHeading(entry.element);
              onNavigate?.();
            }}
            aria-current={activeId === entry.id ? "location" : undefined}
            className={cn(
              "block border-s-2 py-1 pe-2 leading-5 transition-colors duration-200 focus-visible:rounded-e-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              entry.level === 3 ? "ps-6" : "ps-3",
              activeId === entry.id
                ? "-ms-px border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Sticky "On this page" table of contents for docs articles (desktop, `xl`+).
 *
 * Reads the heading ids from the rendered article after each navigation,
 * wires up the CSS-drawn hover "#" deep links, and highlights the section
 * currently in view. Renders nothing on pages with fewer than two headings.
 *
 * @returns The table-of-contents navigation, or `null` when not useful.
 */
export function DocsToc() {
  const { entries, activeId } = useDocsToc(true);

  if (entries.length < 2) {
    return null;
  }

  return (
    <nav aria-label="On this page" className="text-sm">
      <h4 className="text-[11px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
        On this page
      </h4>
      <TocList entries={entries} activeId={activeId} />
    </nav>
  );
}

/**
 * Collapsible "On this page" bar for screens below `xl`, where the sidebar
 * TOC is hidden. Sticks under the site header and shows the current section,
 * like Fumadocs' TOC popover. Closes after a jump.
 *
 * @returns The mobile TOC bar, or `null` on pages with fewer than two headings.
 */
export function DocsTocMobile() {
  const { entries, activeId } = useDocsToc(false);
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = React.useState(pathname);

  // Close when the route changes (adjusting state during render, not in an effect).
  if (openedOn !== pathname) {
    setOpenedOn(pathname);
    setOpen(false);
  }

  if (entries.length < 2) {
    return null;
  }

  const active = entries.find((entry) => entry.id === activeId) ?? entries[0];

  return (
    <nav
      aria-label="On this page"
      className="sticky top-14 z-30 -mx-4 mb-4 border-b bg-background/90 px-4 backdrop-blur supports-backdrop-filter:bg-background/75 sm:-mx-6 sm:px-6 xl:hidden"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 py-2.5 text-start text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="shrink-0 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          On this page
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{active?.text}</span>
        <CaretDownIcon
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="max-h-[60vh] overflow-y-auto pb-3 text-sm">
          <TocList entries={entries} activeId={activeId} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </nav>
  );
}
