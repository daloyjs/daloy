<p align="center">
  <a href="https://daloyjs.dev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://daloyjs.dev/assets/banner-x-1500x500.png">
      <img alt="DaloyJS — Contract-first REST APIs for Node · Bun · Deno · Workers · Edge" src="https://daloyjs.dev/assets/banner-light-1280x426.png" width="100%">
    </picture>
  </a>
</p>

# DaloyJS docs site

The official documentation site for **DaloyJS** — built with Next.js 16, Tailwind CSS v4, and shadcn/ui.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## Build

```bash
pnpm build        # statically pre-renders every docs page
pnpm start        # serve the production build
```

## Deploy

This site is **deployed automatically by [Vercel](https://vercel.com)** through its Git integration: every push to `main` ships a production deploy of [daloyjs.dev](https://daloyjs.dev), and pull requests get preview deployments. There is no manual deploy step — `pnpm build` is only a local verification.

Deployment is **independent of the package release pipeline.** Tagging a `vX.Y.Z` release publishes `@daloyjs/core` (npm + JSR) and `create-daloy` (npm); it does **not** build or deploy this site. The framework version shown in the docs comes from `CORE_PACKAGE_VERSION` in [`lib/seo.ts`](lib/seo.ts) (overridable via the `NEXT_PUBLIC_CORE_PACKAGE_VERSION` env var), which falls back to a hardcoded value — bump that fallback whenever the core version changes.

## Structure

This project uses Next.js' App Router at the repository root (no `src/` directory).

- `app/page.tsx` — landing page (hero, features, comparison matrix, CTA)
- `app/layout.tsx` — root layout, metadata, theme provider
- `app/docs/layout.tsx` — sidebar layout shared by all docs routes
- `app/docs/**` — every docs page (intro, installation, getting started, routing, validation, plugins, errors, openapi, typed-client, testing, security, adapters, deployment, tutorials, api-reference)
- `app/blog/**` — blog posts (one folder per slug)
- `app/sitemap.ts`, `app/robots.ts`, `app/manifest.ts`, `app/opengraph-image.tsx` — generated SEO/PWA assets
- `components/site-header.tsx` — top nav
- `components/docs-sidebar.tsx` + `components/docs-nav.ts` — docs sidebar (edit `docsNav` in `docs-nav.ts` to add pages)
- `components/docs-search.tsx` — `cmdk`-powered docs search
- `components/code-block.tsx` — Shiki-rendered code blocks used in docs and blog pages
- `components/ui/*` — shadcn/ui primitives (button, card, badge, separator, dialog, command, input, input-group, textarea)
- `lib/` — small shared helpers (SEO, structured data, code highlighting)
- `hooks/` — client-side React hooks
- `scripts/` — build-time asset generators (e.g. `assets:render`)
- `proxy.ts` — Next.js proxy / rewrite configuration

## Add a page

1. Create `content/docs/<slug>.mdx` (or `content/docs/<section>/<slug>.mdx`). The route files under `app/docs/` are loaders; do not add a `page.tsx` per page.
2. Add `{ title: "...", href: "/docs/<slug>" }` to the appropriate section of `docsNav` in `components/docs-nav.ts`.
3. Run `pnpm verify:docs-links` from the repo root. The sitemap is derived from the content files, so there is nothing to register there.

For a blog post, create `content/blog/<slug>.mdx` with the required frontmatter. That one file is the whole registration: the blog index, RSS and sitemap read the frontmatter. See [`AGENTS.md`](./AGENTS.md) for the full voice/stack rules and the post checklist.

## Add a shadcn component

Components live under `components/ui/`. Add new primitives by following the shadcn/ui new-york pattern; the registry is configured in `components.json`.
