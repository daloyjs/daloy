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
    title: "Production",
    items: [
      { title: "Security", href: "/docs/security" },
      { title: "Adapters & runtimes", href: "/docs/adapters" },
      { title: "Deployment", href: "/docs/deployment" },
    ],
  },
  {
    title: "Tutorials",
    items: [
      { title: "Build a bookstore API", href: "/docs/tutorials/bookstore" },
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
    <nav className="text-sm">
      {docsNav.map((section) => (
        <div key={section.title} className="pb-6">
          <h4 className="mb-2 px-2 text-sm font-semibold tracking-tight">{section.title}</h4>
          <ul className="space-y-1">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "block rounded-md px-2 py-1.5 transition-colors",
                      active
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
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
