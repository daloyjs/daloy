"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/utils";

export type DocsNavItem = { title: string; href: string };
export type DocsNavSection = { title: string; items: DocsNavItem[] };

export const docsNav: DocsNavSection[] = [
  {
    title: "Get started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Installation", href: "/docs/installation" },
      { title: "Scaffold a project", href: "/docs/scaffolder" },
      { title: "Getting started", href: "/docs/getting-started" },
    ],
  },
  {
    title: "Core concepts",
    items: [
      { title: "Routing", href: "/docs/routing" },
      { title: "Validation", href: "/docs/validation" },
      { title: "Plugins & encapsulation", href: "/docs/plugins" },
      { title: "Errors & problem+json", href: "/docs/errors" },
    ],
  },
  {
    title: "Contracts & clients",
    items: [
      { title: "OpenAPI generation", href: "/docs/openapi" },
      { title: "Typed clients (Hey API)", href: "/docs/typed-client" },
      { title: "Testing & contract tests", href: "/docs/testing" },
    ],
  },
  {
    title: "Architecture",
    items: [
      { title: "Modular monolith", href: "/docs/architecture/modular-monolith" },
    ],
  },
  {
    title: "Database & ORMs",
    items: [
      { title: "Overview", href: "/docs/orm" },
      { title: "Prisma", href: "/docs/orm/prisma" },
      { title: "Drizzle ORM", href: "/docs/orm/drizzle" },
      { title: "TypeORM", href: "/docs/orm/typeorm" },
      { title: "Supabase", href: "/docs/orm/supabase" },
    ],
  },
  {
    title: "Production",
    items: [
      { title: "Security", href: "/docs/security" },
      { title: "Supply-chain security", href: "/docs/security/supply-chain" },
      { title: "Adapters & runtimes", href: "/docs/adapters" },
      { title: "Deployment", href: "/docs/deployment" },
    ],
  },
  {
    title: "Tutorials",
    items: [
      { title: "Build a bookstore API", href: "/docs/tutorials/bookstore" },
      { title: "Large fake REST demo", href: "/docs/tutorials/fake-rest-api" },
    ],
  },
  {
    title: "Reference",
    items: [{ title: "API reference", href: "/docs/api-reference" }],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-8 text-sm lg:pr-4">
      {docsNav.map((section) => (
        <div key={section.title} className="space-y-3">
          <h4 className="px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {section.title}
          </h4>
          <ul className="space-y-1.5 border-l border-border/70 pl-3">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "relative block rounded-r-lg border-l-2 px-3 py-2 leading-6 transition-[color,background-color,border-color] duration-200",
                      active
                        ? "border-primary bg-muted/80 font-medium text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
