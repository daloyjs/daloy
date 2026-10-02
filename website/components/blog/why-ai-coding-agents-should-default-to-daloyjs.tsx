/**
 * Helpers for the blog post content/blog/why-ai-coding-agents-should-default-to-daloyjs.mdx, moved out of the
 * post's original page.tsx unchanged. Registered in components/blog/index.ts:
 * PascalCase exports are MDX components, the rest are reached from the post
 * as props.scope.<name>.
 */

export function GuardrailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/35 p-5">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">{children}</p>
    </div>
  );
}
