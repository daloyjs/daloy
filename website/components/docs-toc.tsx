"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { cn } from "../lib/utils";

type TocEntry = {
  id: string;
  text: string;
  level: 2 | 3;
};

/**
 * Collect the `h2[id]` / `h3[id]` headings of the current docs article and
 * inject a hover "#" anchor link into each one (idempotent, so cached or
 * restored pages are not double-decorated).
 *
 * @param article - The rendered docs article element.
 * @returns The table-of-contents entries in document order.
 */
function collectHeadings(article: HTMLElement): TocEntry[] {
  const headings = article.querySelectorAll<HTMLHeadingElement>(
    "h2[id], h3[id]"
  );
  const entries: TocEntry[] = [];

  for (const heading of headings) {
    entries.push({
      id: heading.id,
      text: heading.textContent?.replace(/\s*#\s*$/, "").trim() ?? heading.id,
      level: heading.tagName === "H2" ? 2 : 3,
    });

    if (!heading.querySelector(".heading-anchor")) {
      const anchor = document.createElement("a");
      anchor.href = `#${heading.id}`;
      anchor.className = "heading-anchor";
      anchor.setAttribute("aria-label", "Link to this section");
      anchor.textContent = "#";
      heading.append(anchor);
    }
  }

  return entries;
}

/**
 * Sticky "On this page" table of contents for docs articles.
 *
 * Reads the heading ids from the rendered article after each navigation,
 * decorates headings with hover anchor links, and highlights the section
 * currently in view via a passive scroll listener. Renders nothing on pages
 * with fewer than two headings.
 *
 * @returns The table-of-contents navigation, or `null` when not useful.
 */
export function DocsToc() {
  const pathname = usePathname();
  const [entries, setEntries] = React.useState<TocEntry[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const article = document.querySelector<HTMLElement>("[data-docs-content]");

    if (!article) {
      setEntries([]);
      return;
    }

    setEntries(collectHeadings(article));
  }, [pathname]);

  React.useEffect(() => {
    if (entries.length === 0) {
      setActiveId(null);
      return;
    }

    let frame = 0;

    const update = () => {
      frame = 0;
      // The heading whose top has most recently crossed under the sticky
      // header (~96px, matching the headings' scroll-mt-24) is "active".
      let current: string | null = entries[0]?.id ?? null;

      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 104) {
          current = entry.id;
        } else {
          break;
        }
      }

      setActiveId(current);
    };

    const onScroll = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [entries]);

  if (entries.length < 2) {
    return null;
  }

  return (
    <nav aria-label="On this page" className="text-sm">
      <h4 className="text-[11px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
        On this page
      </h4>
      <ul className="mt-3 space-y-1 border-s border-border/70">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
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
    </nav>
  );
}
