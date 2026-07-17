import { MagnifyingGlassIcon } from "@phosphor-icons/react/ssr";

/** One sidebar route entry in the faux Scalar navigation. */
type SidebarRoute = {
  method: "GET" | "POST" | "DEL";
  path: string;
  active?: boolean;
};

const SIDEBAR_ROUTES: SidebarRoute[] = [
  { method: "GET", path: "/books" },
  { method: "GET", path: "/books/{id}", active: true },
  { method: "POST", path: "/books" },
  { method: "DEL", path: "/books/{id}" },
];

const METHOD_STYLES: Record<SidebarRoute["method"], string> = {
  GET: "bg-olive-100 text-olive-700 dark:bg-olive-950/50 dark:text-olive-300 dim:bg-olive-950/40 dim:text-olive-200",
  POST: "bg-mist-100 text-mist-700 dark:bg-mist-950/50 dark:text-mist-300 dim:bg-mist-950/40 dim:text-mist-200",
  DEL: "bg-destructive/10 text-destructive",
};

function MethodBadge({ method }: { method: SidebarRoute["method"] }) {
  return (
    <span
      className={`inline-flex w-11 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[9px] font-bold tracking-wide ${METHOD_STYLES[method]}`}
    >
      {method}
    </span>
  );
}

/**
 * A hand-built, theme-aware mockup of the Scalar API reference that
 * `App({ docs: true })` auto-mounts at `/docs`. Rendered as a decorative
 * illustration (`aria-hidden`): the surrounding landing-page copy carries the
 * information, so screen readers skip the faux UI instead of reading a fake
 * sidebar. Kept as markup rather than a PNG so it tracks the site's light,
 * dark, and dim themes and stays sharp at every viewport width.
 */
export function ScalarPreview() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-xl border bg-background shadow-lg dark:shadow-2xl"
    >
      {/* Browser chrome */}
      <div className="flex items-center gap-3 border-b bg-muted/60 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-destructive/50" />
          <span className="size-2.5 rounded-full bg-chart-4/60" />
          <span className="size-2.5 rounded-full bg-olive-400/70 dark:bg-olive-600/70" />
        </span>
        <span className="flex-1 truncate rounded-md border bg-background px-3 py-1 font-mono text-xs text-muted-foreground">
          localhost:3000<span className="text-foreground">/docs</span>
        </span>
      </div>

      <div className="grid md:grid-cols-[190px_minmax(0,1fr)] lg:grid-cols-[210px_minmax(0,1fr)_minmax(0,320px)]">
        {/* Sidebar */}
        <div className="hidden flex-col gap-3 border-r bg-muted/30 p-4 text-xs md:flex">
          <div>
            <p className="text-sm font-bold">Bookstore API</p>
            <p className="text-[10px] text-muted-foreground">v1.0.0 · OpenAPI 3.1</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-muted-foreground">
            <MagnifyingGlassIcon className="size-3" />
            <span className="flex-1">Search</span>
            <kbd className="rounded border bg-muted px-1 text-[9px]">⌘K</kbd>
          </div>
          <div className="flex flex-col gap-1">
            <p className="px-1 pt-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Books
            </p>
            {SIDEBAR_ROUTES.map((route) => (
              <span
                key={`${route.method} ${route.path}`}
                className={`flex items-center gap-2 rounded-md px-1.5 py-1 font-mono ${
                  route.active
                    ? "bg-primary/10 font-semibold text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <MethodBadge method={route.method} />
                {route.path}
              </span>
            ))}
            <p className="px-1 pt-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              Models
            </p>
            <span className="px-1.5 py-0.5 font-mono text-muted-foreground">Book</span>
            <span className="px-1.5 py-0.5 font-mono text-muted-foreground">Problem</span>
          </div>
        </div>

        {/* Operation */}
        <div className="flex flex-col gap-3 p-5 text-sm">
          <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            Books
          </p>
          <p className="text-lg font-bold tracking-tight">Get a book</p>
          <div className="flex items-center gap-2 self-start rounded-lg border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
            <MethodBadge method="GET" />
            /books/{"{id}"}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Returns one book by id. Params and responses below come straight
            from the route&apos;s Zod schemas.
          </p>
          <div className="flex flex-col gap-1.5 text-xs">
            <p className="font-semibold">Path parameters</p>
            <div className="flex items-baseline gap-2 rounded-md border px-2.5 py-1.5">
              <span className="font-mono font-semibold">id</span>
              <span className="text-muted-foreground">string</span>
              <span className="ml-auto text-[10px] font-semibold text-destructive">
                required
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-xs">
            <p className="font-semibold">Responses</p>
            <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
              <span className="size-1.5 rounded-full bg-olive-500 dark:bg-olive-400" />
              <span className="font-mono font-semibold">200</span>
              <span className="text-muted-foreground">Found · Book</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
              <span className="size-1.5 rounded-full bg-destructive/80" />
              <span className="font-mono font-semibold">404</span>
              <span className="text-muted-foreground">
                Not found · application/problem+json
              </span>
            </div>
          </div>
        </div>

        {/* Try-it panel (fixed dark, like a real code column) */}
        <div className="hidden flex-col gap-3 border-l bg-taupe-950 p-4 text-xs text-taupe-100 lg:flex dark:bg-taupe-950/60">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-white/10 px-2 py-1 font-semibold">cURL</span>
            <span className="px-2 py-1 text-taupe-100/50">JavaScript</span>
            <span className="ml-auto rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground">
              Send
            </span>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 font-mono leading-5">
            {"curl localhost:3000/books/42"}
          </pre>
          <p className="text-[10px] font-semibold tracking-wide text-taupe-100/50 uppercase">
            Response · 200 OK
          </p>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 font-mono leading-5">
            {`{
  "id": "42",
  "title": "Book 42"
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
