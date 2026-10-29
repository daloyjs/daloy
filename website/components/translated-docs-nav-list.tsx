"use client";

import type { Route } from "next";

import { NavLink } from "@/components/nav-link";

/**
 * Client half of a translated docs sidebar: active-state links need
 * `NavLink`'s render-prop `className`, which cannot cross the server/client
 * boundary, so the server passes plain data here.
 *
 * @param props.index - The locale's docs index (`href`, `title`).
 * @param props.items - Translated pages in reading order.
 */
export function TranslatedDocsNavList({
  index,
  items,
}: {
  index: { href: string; title: string };
  items: ReadonlyArray<{ href: string; title: string }>;
}) {
  return (
    <>
      <NavLink
        href={index.href as Route}
        exact
        className={({ isActive }) =>
          isActive
            ? "rounded-md bg-muted px-2.5 py-1.5 font-medium text-foreground"
            : "rounded-md px-2.5 py-1.5 font-medium text-foreground hover:bg-muted/60"
        }
      >
        {index.title}
      </NavLink>
      {items.map((item) => (
        <NavLink
          key={item.href}
          href={item.href as Route}
          exact
          className={({ isActive }) =>
            isActive
              ? "rounded-md bg-muted px-2.5 py-1.5 text-foreground"
              : "rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }
        >
          {item.title}
        </NavLink>
      ))}
    </>
  );
}
