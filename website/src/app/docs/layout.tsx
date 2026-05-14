import { DocsSidebar } from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
      <div className="flex gap-8 py-8">
        <aside className="hidden lg:block w-60 shrink-0">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <article className="docs-prose max-w-3xl">{children}</article>
        </main>
      </div>
    </div>
  );
}
