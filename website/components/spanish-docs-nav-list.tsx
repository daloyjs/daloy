"use client";

import type { Route } from "next";

import { NavLink } from "@/components/nav-link";

/**
 * Client half of the Spanish docs sidebar: active-state links need
 * `NavLink`'s render-prop `className`, which cannot cross the server/client
 * boundary, so the server passes plain `{ href, title }` data here.
 *
 * @param props.items - Translated pages in reading order.
 */
export function SpanishDocsNavList({
  items,
}: {
  items: ReadonlyArray<{ href: string; title: string }>;
}) {
  return (
    <>
      <NavLink
        href={"/es/docs" as Route}
        exact
        className={({ isActive }) =>
          isActive
            ? "rounded-md bg-muted px-2.5 py-1.5 font-medium text-foreground"
            : "rounded-md px-2.5 py-1.5 font-medium text-foreground hover:bg-muted/60"
        }
      >
        Documentación en español
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
