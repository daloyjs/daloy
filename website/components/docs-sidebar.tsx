"use client";

import * as React from "react";
import { CaretDownIcon } from "@phosphor-icons/react";

import { useClientPathname } from "@/hooks/use-client-pathname";
import { docsNav, type DocsNavSection } from "./docs-nav";
import { NavLink } from "./nav-link";
import { cn } from "../lib/utils";

/**
 * Whether a docs nav section contains the given pathname.
 */
function sectionContains(section: DocsNavSection, pathname: string | null) {
  return (
    pathname !== null && section.items.some((item) => item.href === pathname)
  );
}

/**
 * Docs sidebar navigation with collapsible sections.
 *
 * Before hydration every section is expanded (so crawlers and no-JS readers
 * see all links); once the pathname is known, only the section containing
 * the current page stays open by default. Manual toggles are kept across
 * navigations, except that the newly active section is always re-opened.
 * On desktop the active link is scrolled into view within the sticky rail.
 *
 * @returns The sidebar navigation element.
 */
export function DocsSidebar() {
  const pathname = useClientPathname();
  const navRef = React.useRef<HTMLElement>(null);
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>(
    {}
  );

  const isOpen = React.useCallback(
    (section: DocsNavSection) =>
      overrides[section.title] ??
      (pathname === null || sectionContains(section, pathname)),
    [overrides, pathname]
  );

  // Re-open the section that owns the new page, then bring the active link
  // into view inside the desktop scroll rail (never scroll the page itself).
  React.useEffect(() => {
    if (pathname === null) return;

    const active = docsNav.find((section) =>
      sectionContains(section, pathname)
    );

    if (active) {
      setOverrides((current) =>
        current[active.title] === false
          ? { ...current, [active.title]: true }
          : current
      );
    }

    const nav = navRef.current;
    const container = nav?.closest<HTMLElement>("[data-sidebar-scroll]");
    const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]');

    if (!container || !link || nav.getBoundingClientRect().height === 0) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();

    if (
      linkRect.top < containerRect.top ||
      linkRect.bottom > containerRect.bottom
    ) {
      container.scrollTop +=
        linkRect.top -
        containerRect.top -
        container.clientHeight / 2 +
        linkRect.height / 2;
    }
  }, [pathname]);

  return (
    <nav ref={navRef} className="space-y-4 text-sm lg:pe-4">
      {docsNav.map((section) => {
        const open = isOpen(section);

        return (
          <div key={section.title}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                setOverrides((current) => ({
                  ...current,
                  [section.title]: !open,
                }))
              }
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-[0.24em] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {section.title}
              <CaretDownIcon
                aria-hidden
                className={cn(
                  "size-3 shrink-0 transition-transform duration-200",
                  !open && "-rotate-90"
                )}
              />
            </button>
            <ul
              hidden={!open}
              className="mt-2 space-y-1.5 border-s border-border/70 ps-3"
            >
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    href={item.href}
                    exact
                    className={({ isActive }) =>
                      cn(
                        "relative block rounded-e-lg border-s-2 px-3 py-2 leading-6 transition-[color,background-color,border-color] duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        isActive
                          ? "border-primary bg-muted/80 font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                      )
                    }
                  >
                    {item.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
