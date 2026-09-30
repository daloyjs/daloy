import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Numbered, vertically connected list of tutorial steps. Wrap each step in a
 * {@link Step}; numbering comes from a CSS counter, so steps can be reordered
 * without renumbering by hand.
 *
 * @example
 * <Steps>
 *   <Step title="Install">…</Step>
 *   <Step title="Run the dev server">…</Step>
 * </Steps>
 */
export function Steps({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ol data-steps className={cn("docs-steps not-prose my-8", className)}>
      {children}
    </ol>
  );
}

/** Props accepted by {@link Step}. */
export interface StepProps {
  /** Short step heading. */
  title: ReactNode;
  /**
   * Optional anchor id so the step shows up in the "On this page" TOC and can
   * be deep-linked. Rendered on the step heading as an `h3`.
   */
  id?: string;
  children?: ReactNode;
}

/** A single step inside {@link Steps}. */
export function Step({ title, id, children }: StepProps) {
  return (
    <li className="docs-step">
      <h3 id={id} className="docs-step__title">
        {title}
      </h3>
      <div className="docs-step__body">{children}</div>
    </li>
  );
}
