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

## Structure

- `src/app/page.tsx` — landing page (hero, features, comparison matrix, CTA)
- `src/app/docs/layout.tsx` — sidebar layout for all docs routes
- `src/app/docs/**` — every docs page (intro, installation, getting started, routing, validation, plugins, errors, openapi, typed-client, testing, security, adapters, deployment, tutorials, api-reference)
- `src/components/site-header.tsx` — top nav
- `src/components/docs-sidebar.tsx` — docs sidebar (edit `docsNav` to add pages)
- `src/components/code-block.tsx` — code-block component used in docs pages
- `src/components/ui/*` — shadcn/ui primitives (button, card, badge, separator)

## Add a page

1. Create `src/app/docs/<slug>/page.tsx` — export a default React component.
2. Add `{ title: "...", href: "/docs/<slug>" }` to the appropriate section of `docsNav` in `src/components/docs-sidebar.tsx`.

## Add a shadcn component

Components live under `src/components/ui/`. Add new primitives by following the shadcn/ui new-york pattern; the registry is configured in `components.json`.
