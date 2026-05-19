"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsNav } from "./docs-nav";
import { cn } from "../lib/utils";

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-8 text-sm lg:pe-4">
      {docsNav.map((section) => (
        <div key={section.title} className="space-y-3">
          <h4 className="px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {section.title}
          </h4>
          <ul className="space-y-1.5 border-s border-border/70 ps-3">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    transitionTypes={["nav-forward"]}
                    className={cn(
                      "relative block rounded-e-lg border-s-2 px-3 py-2 leading-6 transition-[color,background-color,border-color] duration-200",
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
