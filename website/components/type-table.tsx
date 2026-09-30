import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** One property row in a {@link TypeTable}. */
export interface TypeTableEntry {
  /** TypeScript type, shown in monospace, e.g. `"number"` or `"(ctx: Context) => void"`. */
  type: string;
  /** What the option does. */
  description?: ReactNode;
  /** Default value as source text, e.g. `"1_048_576"`. */
  default?: string;
  /** Whether the option must be provided. */
  required?: boolean;
  /** Deprecation note; when set the row is struck through and the note shown. */
  deprecated?: string;
}

/** Props accepted by {@link TypeTable}. */
export interface TypeTableProps {
  /** Rows keyed by property name, rendered in insertion order. */
  type: Record<string, TypeTableEntry>;
  className?: string;
}

/**
 * Property table for an options object or interface: name, type, default and
 * description. Used for API reference pages instead of hand-built HTML tables,
 * so every options table in the docs reads the same way.
 *
 * On narrow screens each row stacks into a card; from `sm` it becomes a grid.
 */
export function TypeTable({ type, className }: TypeTableProps) {
  const rows = Object.entries(type);

  return (
    <div data-type-table className={cn("not-prose my-6 overflow-hidden rounded-xl border text-sm", className)}>
      <div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(8rem,1.3fr)_minmax(5rem,0.7fr)] gap-4 border-b bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
        <span>Property</span>
        <span>Type</span>
        <span>Default</span>
      </div>
      <dl className="divide-y">
        {rows.map(([name, entry]) => (
          <div key={name} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1.3fr)_minmax(5rem,0.7fr)]">
            <dt className="flex flex-wrap items-center gap-1.5 font-mono text-[13px] font-semibold text-foreground">
              <span className={entry.deprecated ? "line-through opacity-70" : undefined}>{name}</span>
              {entry.required ? (
                <span className="rounded bg-rose-500/10 px-1.5 py-px font-sans text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  required
                </span>
              ) : null}
            </dt>
            <dd className="min-w-0 font-mono text-[13px] break-words text-sky-700 dark:text-sky-300">
              {entry.type}
            </dd>
            <dd className="font-mono text-[13px] text-muted-foreground">
              <span className="me-1 font-sans text-xs sm:hidden">Default:</span>
              {entry.default ?? "-"}
            </dd>
            {entry.description || entry.deprecated ? (
              <dd className="leading-6 text-muted-foreground sm:col-span-3 [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.92em]">
                {entry.deprecated ? (
                  <span className="me-1 font-medium text-amber-700 dark:text-amber-300">
                    Deprecated: {entry.deprecated}
                  </span>
                ) : null}
                {entry.description}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}
