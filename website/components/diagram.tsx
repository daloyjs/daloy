import type { ReactNode } from "react";

import { cn } from "../lib/utils";

/**
 * Visual emphasis applied to a single diagram node.
 *
 * - `default`: neutral card styling, the common case.
 * - `accent`: highlights the node the surrounding prose is talking about
 *   (e.g. the route handler in a request pipeline).
 * - `muted`: de-emphasised infrastructure or "plumbing" nodes.
 * - `danger`: a failure, rejection, or attack path (e.g. a blocked request).
 * - `success`: a successful terminal state (e.g. a 2xx response).
 */
export type DiagramTone =
  | "default"
  | "accent"
  | "muted"
  | "danger"
  | "success";

const TONE_NODE: Record<DiagramTone, string> = {
  default: "border-border bg-card",
  accent: "border-primary/45 bg-primary/[0.06] ring-1 ring-primary/15",
  muted: "border-border/70 bg-muted/50",
  danger: "border-destructive/45 bg-destructive/[0.06]",
  success: "border-emerald-500/45 bg-emerald-500/[0.06]",
};

const TONE_DOT: Record<DiagramTone, string> = {
  default: "bg-muted-foreground/50",
  accent: "bg-primary",
  muted: "bg-muted-foreground/35",
  danger: "bg-destructive",
  success: "bg-emerald-500",
};

/**
 * Right-pointing connector arrow drawn with `currentColor` so it inherits the
 * surrounding text color and adapts to light/dark/dim themes automatically.
 *
 * On narrow viewports flows stack vertically, so the arrow is rotated to point
 * downward via the `rotate-90 md:rotate-0` utility passed by callers.
 *
 * @param props.className - Extra classes (used for rotation and sizing).
 * @returns A decorative SVG arrow (hidden from assistive tech).
 */
function ConnectorArrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn(
        "h-5 w-5 shrink-0 text-muted-foreground/60",
        className,
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/**
 * A single labelled box used inside every diagram variant.
 *
 * @param props.index - Optional 1-based step number, rendered zero-padded (`01`).
 * @param props.eyebrow - Optional small uppercase label above the title.
 * @param props.label - The node's primary title.
 * @param props.detail - Optional secondary line, rendered in a monospace font
 *   for code-like values (paths, identifiers, schemas).
 * @param props.tone - Visual emphasis, see {@link DiagramTone}.
 * @param props.className - Extra classes for layout (width, flex).
 * @returns A themeable node element.
 */
function DiagramNode({
  index,
  eyebrow,
  label,
  detail,
  tone = "default",
  className,
}: {
  index?: number;
  eyebrow?: string;
  label: ReactNode;
  detail?: ReactNode;
  tone?: DiagramTone;
  className?: string;
}) {
  const showHeader = index !== undefined || eyebrow !== undefined;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-1 rounded-lg border px-4 py-3 text-left shadow-sm",
        TONE_NODE[tone],
        className,
      )}
    >
      {showHeader ? (
        <span className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])}
          />
          {index !== undefined ? (
            <span>{String(index).padStart(2, "0")}</span>
          ) : null}
          {eyebrow ? <span className="truncate">{eyebrow}</span> : null}
        </span>
      ) : null}
      <span className="text-sm leading-snug font-semibold text-foreground">
        {label}
      </span>
      {detail ? (
        <span className="font-mono text-xs leading-snug break-words text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Shared figure wrapper that frames any diagram with an optional eyebrow title
 * and a caption. Use it directly to compose a bespoke diagram, or rely on the
 * higher-level variants ({@link FlowDiagram}, {@link LayerStack},
 * {@link BranchDiagram}, {@link SequenceDiagram}) which wrap it for you.
 *
 * The figure is a self-contained block: it sets its own vertical rhythm so it
 * can be dropped straight into a `.docs-prose` article. The whole figure is
 * exposed to assistive tech as a single labelled group, and because every node
 * is real text the diagram is fully readable by screen readers and search.
 *
 * @param props.title - Optional eyebrow shown above the surface.
 * @param props.caption - Optional descriptive caption shown below the surface.
 * @param props.ariaLabel - Accessible name for the figure; defaults to `title`.
 * @param props.children - The diagram body.
 * @param props.className - Extra classes for the surface container.
 * @returns A `<figure>` framing the diagram.
 */
export function Diagram({
  title,
  caption,
  ariaLabel,
  children,
  className,
}: {
  title?: string;
  caption?: string;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure
      role="group"
      aria-label={ariaLabel ?? title ?? caption}
      className="float-up my-8 flex flex-col gap-3"
    >
      {title ? (
        <figcaption className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          <span aria-hidden="true" className="h-px w-6 bg-border" />
          {title}
        </figcaption>
      ) : null}
      <div
        className={cn(
          "rounded-xl border border-border bg-gradient-to-b from-muted/40 to-background p-4 sm:p-6",
          className,
        )}
      >
        {children}
      </div>
      {caption ? (
        <figcaption className="text-sm leading-6 text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** One step in a {@link FlowDiagram}. */
export type FlowStep = {
  /** Primary title of the step. */
  label: ReactNode;
  /** Optional code-like secondary line (path, schema, identifier). */
  detail?: ReactNode;
  /** Optional small uppercase label above the title. */
  eyebrow?: string;
  /** Visual emphasis, see {@link DiagramTone}. */
  tone?: DiagramTone;
};

/**
 * A linear pipeline of connected steps, the most common documentation diagram.
 * Renders left-to-right on `md+` screens (right arrows) and stacks top-to-bottom
 * on small screens (down arrows), so it stays readable on mobile.
 *
 * Ideal for request/response pipelines, codegen flows (route → schema → OpenAPI
 * → client), and any "A then B then C" process.
 *
 * @param props.steps - Ordered steps to render.
 * @param props.title - Optional figure eyebrow.
 * @param props.caption - Optional figure caption.
 * @param props.numbered - When true, prefixes each step with a zero-padded index.
 * @returns A framed flow diagram.
 */
export function FlowDiagram({
  steps,
  title,
  caption,
  numbered = false,
}: {
  steps: FlowStep[];
  title?: string;
  caption?: string;
  numbered?: boolean;
}) {
  return (
    <Diagram title={title} caption={caption}>
      <ol className="flex list-none flex-col items-stretch gap-2 p-0 md:flex-row md:flex-wrap md:items-center">
        {steps.map((step, index) => (
          <li
            key={index}
            className="flex flex-col items-stretch gap-2 md:flex-1 md:flex-row md:items-center"
          >
            <DiagramNode
              index={numbered ? index + 1 : undefined}
              eyebrow={step.eyebrow}
              label={step.label}
              detail={step.detail}
              tone={step.tone}
              className="md:flex-1"
            />
            {index < steps.length - 1 ? (
              <ConnectorArrow className="mx-auto rotate-90 md:mx-0 md:rotate-0" />
            ) : null}
          </li>
        ))}
      </ol>
    </Diagram>
  );
}

/** One horizontal layer in a {@link LayerStack}. */
export type DiagramLayer = {
  /** Title of the layer (e.g. "modules", "shared kernel"). */
  title: ReactNode;
  /** Optional short description shown beside the title. */
  detail?: ReactNode;
  /** Optional chips listing the things that live in this layer. */
  items?: ReactNode[];
  /** Visual emphasis, see {@link DiagramTone}. */
  tone?: DiagramTone;
};

/**
 * A vertical stack of full-width layers, top to bottom. Perfect for layered
 * architectures (app → modules → shared kernel), middleware stacks, or any
 * "higher level depends on lower level" relationship.
 *
 * @param props.layers - Layers from top to bottom.
 * @param props.title - Optional figure eyebrow.
 * @param props.caption - Optional figure caption.
 * @param props.flow - Direction hint shown between layers: `down` (default),
 *   `up`, or `both`. Purely decorative.
 * @returns A framed layered-architecture diagram.
 */
export function LayerStack({
  layers,
  title,
  caption,
  flow = "down",
}: {
  layers: DiagramLayer[];
  title?: string;
  caption?: string;
  flow?: "down" | "up" | "both";
}) {
  return (
    <Diagram title={title} caption={caption}>
      <div className="flex flex-col gap-2">
        {layers.map((layer, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div
              className={cn(
                "flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                TONE_NODE[layer.tone ?? "default"],
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground">
                  {layer.title}
                </span>
                {layer.detail ? (
                  <span className="text-xs text-muted-foreground">
                    {layer.detail}
                  </span>
                ) : null}
              </div>
              {layer.items && layer.items.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {layer.items.map((item, itemIndex) => (
                    <span
                      key={itemIndex}
                      className="rounded-md border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {index < layers.length - 1 ? (
              <div
                aria-hidden="true"
                className="flex justify-center text-muted-foreground/60"
              >
                <ConnectorArrow
                  className={cn(
                    "rotate-90",
                    flow === "up" && "-rotate-90",
                  )}
                />
                {flow === "both" ? (
                  <ConnectorArrow className="-rotate-90" />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Diagram>
  );
}

/** A single target node in a {@link BranchDiagram}. */
export type BranchNode = {
  /** Title of the branch. */
  label: ReactNode;
  /** Optional code-like secondary line. */
  detail?: ReactNode;
  /** Optional small uppercase label above the title. */
  eyebrow?: string;
  /** Visual emphasis, see {@link DiagramTone}. */
  tone?: DiagramTone;
};

/**
 * A one-to-many fan-out: a single source node branches into several targets,
 * with an optional converge node where the branches rejoin. Use it for
 * dispatch/registration ("app registers N modules"), single-source codegen
 * ("OpenAPI → docs / client / contract tests"), or load-balancing fan-outs.
 *
 * Branches render as a responsive grid; the connecting arrows point down on all
 * viewports so the source → branches → converge reading order is unambiguous.
 *
 * @param props.source - The single upstream node.
 * @param props.branches - The downstream nodes the source fans out to.
 * @param props.converge - Optional node where branches rejoin.
 * @param props.title - Optional figure eyebrow.
 * @param props.caption - Optional figure caption.
 * @returns A framed fan-out diagram.
 */
export function BranchDiagram({
  source,
  branches,
  converge,
  title,
  caption,
}: {
  source: BranchNode;
  branches: BranchNode[];
  converge?: BranchNode;
  title?: string;
  caption?: string;
}) {
  return (
    <Diagram title={title} caption={caption}>
      <div className="flex flex-col items-stretch gap-2">
        <DiagramNode
          eyebrow={source.eyebrow}
          label={source.label}
          detail={source.detail}
          tone={source.tone ?? "accent"}
          className="mx-auto w-full sm:w-2/3"
        />
        <div
          aria-hidden="true"
          className="flex justify-center text-muted-foreground/60"
        >
          <ConnectorArrow className="rotate-90" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((branch, index) => (
            <DiagramNode
              key={index}
              eyebrow={branch.eyebrow}
              label={branch.label}
              detail={branch.detail}
              tone={branch.tone}
            />
          ))}
        </div>
        {converge ? (
          <>
            <div
              aria-hidden="true"
              className="flex justify-center text-muted-foreground/60"
            >
              <ConnectorArrow className="rotate-90" />
            </div>
            <DiagramNode
              eyebrow={converge.eyebrow}
              label={converge.label}
              detail={converge.detail}
              tone={converge.tone ?? "success"}
              className="mx-auto w-full sm:w-2/3"
            />
          </>
        ) : null}
      </div>
    </Diagram>
  );
}

/** Direction of a {@link SequenceStep} message. */
export type SequenceKind = "request" | "response" | "async" | "note";

const KIND_LABEL: Record<SequenceKind, string> = {
  request: "request",
  response: "response",
  async: "async",
  note: "note",
};

const KIND_TONE: Record<SequenceKind, DiagramTone> = {
  request: "accent",
  response: "success",
  async: "muted",
  note: "default",
};

/** One message exchanged between participants in a {@link SequenceDiagram}. */
export type SequenceStep = {
  /** Label of the sending participant. */
  from: string;
  /** Label of the receiving participant. */
  to: string;
  /** What is being sent. */
  label: ReactNode;
  /** Optional code-like detail (payload, header, status). */
  detail?: ReactNode;
  /** Message direction/category, drives the accent color. */
  kind?: SequenceKind;
};

/**
 * A request/response sequence between two or more participants, rendered as a
 * numbered, top-to-bottom list of messages rather than a wide SVG with
 * lifelines, which keeps it fully responsive and readable on phones. The
 * participants are shown as a legend above the steps.
 *
 * Ideal for protocol exchanges (OAuth2 / OIDC, webhook delivery with retries,
 * mTLS handshakes, idempotency replays).
 *
 * @param props.participants - The actors involved, in column order.
 * @param props.steps - Ordered messages between participants.
 * @param props.title - Optional figure eyebrow.
 * @param props.caption - Optional figure caption.
 * @returns A framed sequence diagram.
 */
export function SequenceDiagram({
  participants,
  steps,
  title,
  caption,
}: {
  participants: string[];
  steps: SequenceStep[];
  title?: string;
  caption?: string;
}) {
  return (
    <Diagram title={title} caption={caption}>
      <div className="mb-4 flex flex-wrap gap-2">
        {participants.map((participant) => (
          <span
            key={participant}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm"
          >
            {participant}
          </span>
        ))}
      </div>
      <ol className="flex list-none flex-col gap-2 p-0">
        {steps.map((step, index) => {
          const kind = step.kind ?? "request";
          return (
            <li
              key={index}
              className={cn(
                "flex flex-col gap-1 rounded-lg border px-4 py-3",
                TONE_NODE[KIND_TONE[kind]],
              )}
            >
              <span className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span
                  aria-hidden="true"
                  className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[KIND_TONE[kind]])}
                />
                <span>{KIND_LABEL[kind]}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                <span>{step.from}</span>
                <ConnectorArrow className="h-4 w-4" />
                <span>{step.to}</span>
              </span>
              <span className="text-sm text-foreground/90">{step.label}</span>
              {step.detail ? (
                <span className="font-mono text-xs break-words text-muted-foreground">
                  {step.detail}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Diagram>
  );
}
