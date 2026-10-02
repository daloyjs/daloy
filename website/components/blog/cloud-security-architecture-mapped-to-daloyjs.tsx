/**
 * Helpers for the blog post content/blog/cloud-security-architecture-mapped-to-daloyjs.mdx, moved out of the
 * post's original page.tsx unchanged. Registered in components/blog/index.ts:
 * PascalCase exports are MDX components, the rest are reached from the post
 * as props.scope.<name>.
 */
import { Badge } from "@/components/ui/badge";

export function PrincipleCard({
  principle,
  framework,
  platform,
}: {
  principle: string;
  framework: string;
  platform: string;
}) {
  return (
    <div className="not-prose my-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">{principle}</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          DaloyJS ships
        </dt>
        <dd>{framework}</dd>
        <dt className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          You / your cloud
        </dt>
        <dd className="text-muted-foreground">{platform}</dd>
      </dl>
    </div>
  );
}
