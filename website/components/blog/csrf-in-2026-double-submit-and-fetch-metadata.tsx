/**
 * Helpers for the blog post content/blog/csrf-in-2026-double-submit-and-fetch-metadata.mdx, moved out of the
 * post's original page.tsx unchanged. Registered in components/blog/index.ts:
 * PascalCase exports are MDX components, the rest are reached from the post
 * as props.scope.<name>.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function EditorFrame({
  files,
  activeFile,
  status,
  children,
  className,
}: {
  files: readonly string[];
  activeFile: string;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400/80" aria-hidden />
          <span
            className="size-2.5 rounded-full bg-yellow-400/80"
            aria-hidden
          />
          <span className="size-2.5 rounded-full bg-green-400/80" aria-hidden />
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {files.map((file) => {
            const isActive = file === activeFile;
            return (
              <span
                key={file}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] sm:text-xs",
                  isActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground"
                )}
              >
                {file}
              </span>
            );
          })}
        </div>
      </div>
      <div className="bg-background">{children}</div>
      {status ? (
        <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase sm:text-[11px]">
          <span className="truncate">{status}</span>
          <span aria-hidden>TS · UTF-8 · LF</span>
        </div>
      ) : null}
    </div>
  );
}

export function StrategyCard({
  name,
  tag,
  good,
  bad,
}: {
  name: string;
  tag: string;
  good: readonly string[];
  bad: readonly string[];
}) {
  return (
    <div className="not-prose my-4 rounded-xl border bg-muted/30 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-lg font-semibold tracking-tight">{name}</h4>
        <Badge variant="outline" className="font-mono">
          {tag}
        </Badge>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            holds up against
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {good.map((g) => (
              <li key={g} className="flex gap-2">
                <span aria-hidden className="text-emerald-500">
                  ✓
                </span>
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            breaks under
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {bad.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden className="text-amber-500">
                  !
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
