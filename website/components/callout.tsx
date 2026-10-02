import type { ReactNode } from "react";
import {
  InfoIcon,
  LightbulbIcon,
  ShieldCheckIcon,
  WarningIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/** The visual intent of a {@link Callout}. */
export type CalloutType = "note" | "tip" | "warning" | "danger" | "security";

const CALLOUT_STYLES: Record<
  CalloutType,
  { label: string; Icon: typeof InfoIcon; box: string; icon: string }
> = {
  note: {
    label: "Note",
    Icon: InfoIcon,
    box: "border-sky-500/25 bg-sky-500/[0.04] dark:bg-sky-500/[0.07]",
    icon: "text-sky-600 dark:text-sky-400",
  },
  tip: {
    label: "Tip",
    Icon: LightbulbIcon,
    box: "border-emerald-500/25 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.07]",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    label: "Warning",
    Icon: WarningIcon,
    box: "border-amber-500/30 bg-amber-500/[0.05] dark:bg-amber-500/[0.07]",
    icon: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    label: "Danger",
    Icon: WarningOctagonIcon,
    box: "border-rose-500/30 bg-rose-500/[0.04] dark:bg-rose-500/[0.07]",
    icon: "text-rose-600 dark:text-rose-400",
  },
  security: {
    label: "Security",
    Icon: ShieldCheckIcon,
    box: "border-primary/30 bg-primary/[0.04]",
    icon: "text-primary",
  },
};

/** Props accepted by {@link Callout}. */
export interface CalloutProps {
  /** Visual intent; defaults to `note`. */
  type?: CalloutType;
  /** Optional heading. Falls back to the type label ("Note", "Warning", …). */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Admonition box for asides in docs and blog prose: notes, tips, warnings,
 * dangers, and security guidance. Replaces the one-off bordered `<div>`s that
 * pages used to hand-roll.
 *
 * Rendered as an `<aside>` with `role="note"` so screen readers announce it as
 * supplementary content. Inline-code styling skips `<pre>` blocks, so a
 * `CodeBlock` inside a callout keeps its own look. For OAuth role labelling
 * use `AuthRole` instead.
 */
export function Callout({ type = "note", title, children, className }: CalloutProps) {
  const style = CALLOUT_STYLES[type];
  const { Icon } = style;

  return (
    <aside
      role="note"
      data-callout={type}
      className={cn("not-prose my-6 flex gap-3 rounded-xl border p-4 text-sm leading-6", style.box, className)}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4.5 shrink-0", style.icon)} weight="duotone" />
      <div className="min-w-0 flex-1 space-y-2 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.92em] [&_p]:m-0">
        <p className="font-semibold text-foreground" data-callout-title>
          {title ?? style.label}
        </p>
        <div className="space-y-2 text-foreground/90">{children}</div>
      </div>
    </aside>
  );
}
