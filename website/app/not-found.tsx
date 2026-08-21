import Link from "next/link";
import type { Route } from "next";

/**
 * HTML 404 for browsers. Agents that send `Accept: text/markdown` are rewritten
 * to `/md/...` in proxy.ts and receive a Markdown recovery body instead, still
 * with HTTP 404. JSON API clients receive problem+json from `/api` and
 * `/openapi.json`.
 */
export default function NotFound() {
  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16 lg:py-24">
        <p className="font-mono text-sm font-semibold tracking-widest text-sky-600 uppercase dark:text-sky-300">
          404
        </p>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Page not found</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">
            That path does not exist on daloyjs.dev. If you followed a stale
            link, the sitemap, the agent index, and the docs home are the
            recovery paths.
          </p>
        </div>
        <ul className="list-disc space-y-2 ps-5 text-muted-foreground">
          <li>
            <Link className="underline underline-offset-4" href={"/" as Route}>
              Home
            </Link>
          </li>
          <li>
            <Link className="underline underline-offset-4" href={"/docs" as Route}>
              Docs index
            </Link>
          </li>
          <li>
            <a className="underline underline-offset-4" href="/llms.txt">
              llms.txt
            </a>
          </li>
          <li>
            <a className="underline underline-offset-4" href="/sitemap.xml">
              Sitemap
            </a>
          </li>
          <li>
            <Link className="underline underline-offset-4" href={"/contact" as Route}>
              Contact
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
