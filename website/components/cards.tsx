import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * Responsive grid of link cards, for "where to go next" sections and section
 * index pages. One column on phones, two from `sm`.
 */
export function Cards({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("not-prose my-6 grid gap-3 sm:grid-cols-2", className)}>{children}</div>;
}

/** Props accepted by {@link Card}. */
export interface CardProps {
  title: ReactNode;
  /** Internal route (`/docs/...`) or absolute `https://` URL. External URLs open in a new tab. */
  href: string;
  children?: ReactNode;
  /** Optional leading icon element. */
  icon?: ReactNode;
}

/**
 * A single linked card inside {@link Cards}. The whole card is the link
 * target; external links get `rel="noopener noreferrer"` and an outbound arrow.
 */
export function Card({ title, href, children, icon }: CardProps) {
  const external = /^https?:\/\//.test(href);
  const Arrow = external ? ArrowUpRightIcon : ArrowRightIcon;
  const className =
    "group flex h-full flex-col gap-1.5 rounded-xl border bg-card p-4 text-sm font-normal no-underline transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  const body = (
    <>
      <span className="flex items-center gap-2 font-semibold text-foreground">
        {icon ? <span className="text-muted-foreground [&_svg]:size-4">{icon}</span> : null}
        <span className="min-w-0 flex-1">{title}</span>
        <Arrow
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </span>
      {children ? <span className="leading-6 text-muted-foreground">{children}</span> : null}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={href as Route} className={className}>
      {body}
    </Link>
  );
}
