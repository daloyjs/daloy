/**
 * Helpers for the blog post content/blog/state-of-ai-security-2026-what-the-report-means-for-backends.mdx, moved out of the
 * post's original page.tsx unchanged. Registered in components/blog/index.ts:
 * PascalCase exports are MDX components, the rest are reached from the post
 * as props.scope.<name>.
 */
import { cn } from "@/lib/utils";

type BarTone = "default" | "accent" | "danger" | "success";

export const BAR_TONE: Record<BarTone, string> = {
  default: "bg-muted-foreground/40",
  accent: "bg-primary",
  danger: "bg-destructive",
  success: "bg-emerald-500",
};

export function BarChart({
  title,
  caption,
  unit = "%",
  max = 100,
  bars,
}: {
  title: string;
  caption?: string;
  unit?: string;
  max?: number;
  bars: { label: string; value: number; tone?: BarTone }[];
}) {
  return (
    <figure className="not-prose my-8 rounded-xl border bg-card p-5 shadow-sm">
      <figcaption className="mb-4 text-sm font-semibold text-foreground">
        {title}
      </figcaption>
      <div className="flex flex-col gap-3">
        {bars.map((bar) => {
          const pct = Math.max(0, Math.min(100, (bar.value / max) * 100));
          return (
            <div
              key={bar.label}
              className="grid gap-1 sm:grid-cols-[minmax(0,13rem)_1fr] sm:items-center sm:gap-3"
            >
              <span className="text-sm text-muted-foreground">{bar.label}</span>
              <div className="flex items-center gap-2">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      BAR_TONE[bar.tone ?? "default"]
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-sm font-medium text-foreground tabular-nums">
                  {bar.value}
                  {unit}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {caption ? (
        <figcaption className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function StatGrid({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <div className="not-prose my-8 grid gap-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border bg-card p-5 text-center shadow-sm"
        >
          <div className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
            {stat.value}
          </div>
          <div className="mt-2 text-sm leading-snug text-muted-foreground">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
