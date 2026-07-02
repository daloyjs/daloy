"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * Mobile "Browse docs" disclosure for the docs layout.
 *
 * Wraps the sidebar in a native `<details>` element and closes it whenever
 * the pathname changes, so picking a page never leaves the (very long)
 * expanded navigation sitting above the new article.
 *
 * @param children - The docs sidebar navigation to disclose.
 * @returns The disclosure element.
 */
export function DocsNavDisclosure({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const ref = React.useRef<HTMLDetailsElement>(null);

  React.useEffect(() => {
    if (ref.current?.open) {
      ref.current.open = false;
    }
  }, [pathname]);

  return (
    <details
      ref={ref}
      className="docs-nav-disclosure overflow-hidden rounded-xl border border-border bg-background/95 shadow-sm backdrop-blur"
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        Browse docs
      </summary>

      <div className="docs-nav-disclosure__panel border-t border-border px-4 py-4">
        {children}
      </div>
    </details>
  );
}
