/**
 * Helpers for the blog post content/blog/aikido-top-10-app-security-problems-mapped-to-daloyjs.mdx, moved out of the
 * post's original page.tsx unchanged. Registered in components/blog/index.ts:
 * PascalCase exports are MDX components, the rest are reached from the post
 * as props.scope.<name>.
 */
import { Badge } from "@/components/ui/badge";

type ItemStatus = "default" | "opt-in" | "n/a" | "gap-closed";

export const STATUS_COPY: Record<ItemStatus, { label: string; tone: string }> = {
  default: { label: "On by default", tone: "default" },
  "opt-in": { label: "One opt-in line", tone: "secondary" },
  "n/a": { label: "Not applicable", tone: "outline" },
  "gap-closed": { label: "Gap closed", tone: "destructive" },
};

export function ThreatCard({
  num,
  threat,
  status,
  framework,
  user,
}: {
  num: number;
  threat: string;
  status: ItemStatus;
  framework: string;
  user: string;
}) {
  const meta = STATUS_COPY[status];
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">
          #{num}
        </Badge>
        <span className="text-base font-semibold">{threat}</span>
        <Badge
          variant={
            meta.tone === "default"
              ? "default"
              : meta.tone === "secondary"
                ? "secondary"
                : meta.tone === "destructive"
                  ? "destructive"
                  : "outline"
          }
        >
          {meta.label}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS ships
        </dt>
        <dd>{framework}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          You still own
        </dt>
        <dd className="text-muted-foreground">{user}</dd>
      </dl>
    </div>
  );
}
