<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in node_modules/next/dist/docs/ before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

This is the marketing and documentation website for Daloy, a Next.js 16 + React 19 app using Tailwind v4 and shadcn/ui.

Use pnpm for package management and all scripts.

## Commands

Use these package scripts from `package.json`:

- `pnpm dev` — `next dev`
- `pnpm build` — `next build`
- `pnpm start` — `next start`
- `pnpm lint` — `eslint`
- `pnpm format` — `prettier --write "**/*.{ts,tsx}"`
- `pnpm typecheck` — `tsc --noEmit`

Run `pnpm lint` and `pnpm typecheck` before finishing code changes when relevant.

## Repo notes

- Docs navigation, sitemap entries, and search discovery are manually maintained. When changing docs routes, check [components/docs-sidebar.tsx](components/docs-sidebar.tsx), [components/docs-nav.ts](components/docs-nav.ts), [app/sitemap.ts](app/sitemap.ts), and [lib/docs-search.ts](lib/docs-search.ts). Run `pnpm verify:docs-links` from the repo root afterwards — it fails on broken internal `/docs` links, dangling nav/sitemap entries, pages missing from the sitemap, nav↔sitemap drift, and broken `#anchor` targets.
- Every new documentation page under `app/docs/` must include a diagram that matches the current documentation style. Use the existing docs pages as the visual baseline so new pages keep the same diagram-led explanation pattern.
- Database docs split SQL ORMs (`/docs/orm`) from ODMs (`/docs/odm`); Supabase is treated as a platform client, not an ORM.

## Blog authoring

When writing a new blog post under `app/blog/<slug>/page.tsx`, follow these rules.

### Voice and tone

- Write as the site's author: a Filipino fullstack developer with ~12 years of experience, currently based in Norway. Do **not** insert Tagalog words or Norwegian phrases — keep the prose in English.
- English is strong but not native-level. Favor clear, direct sentences over flowery or academic phrasing. Occasional small informalities are fine; corporate-marketing tone is not.
- Be funny. Dry humor, light self-deprecation, and the occasional aside are welcome — Filipinos are funny, and the blog should sound like a real person, not a changelog. Keep jokes inclusive and never punch down.
- Speak from lived experience ("I've shipped this", "I learned the hard way", "in a previous job"). Avoid pretending to be a neutral documentation voice — that's what `/docs` is for.
- Opinions are encouraged when they're backed by reasoning. Avoid hedging every sentence.
- **Never use an em dash (—) anywhere in content or writing.** In the context of artificial intelligence, an em dash is a punctuation mark frequently utilized by Large Language Models (LLMs) to interrupt thoughts, connect clauses, or add emphasis. It has become widely recognized as a "tell" or signature of AI-generated writing. Rewrite sentences using commas, colons, parentheses, or separate sentences instead.

### Content and formatting

- Don't hesitate to mock up a **text-editor UI** (file tabs, line numbers, a faux terminal) inside a post when it helps explain code or a principle. Use the existing primitives — typically the `CodeBlock` component plus Tailwind containers — rather than inventing new ones.
- Stack: assume the **latest Next.js (App Router) + React 19 + Tailwind v4 + shadcn/ui**. Examples and screenshots should reflect that combination; don't regress to Pages Router, Tailwind v3 syntax, or pre-React-19 patterns.
- Code samples must be runnable or clearly marked as illustrative. Prefer TypeScript.
- Keep posts skimmable: short intro, headings every few paragraphs, a concrete takeaway near the end.

### Checklist for every new post

1. Create `app/blog/<slug>/page.tsx` with `buildMetadata({ title, description, path: "/blog/<slug>", keywords: [...] })`.
2. **Adjust the date** — use the current real-world date for `publishedAt` / displayed date, not a copy-pasted one from another post.
3. Add the post to the `POSTS` (or equivalent) list in [app/blog/page.tsx](app/blog/page.tsx) so it appears on the blog index.
4. Add a matching entry to `STATIC_PATHS` in [app/sitemap.ts](app/sitemap.ts) (`changeFrequency: "monthly"`, `priority: 0.7` to match siblings).
5. Run `pnpm lint` and `pnpm typecheck` before finishing.

## Skills

Skills are on-demand workflow docs. Read only the matching `SKILL.md` when its trigger applies.

- [.agents/skills/deploy-to-vercel/SKILL.md](.agents/skills/deploy-to-vercel/SKILL.md) — deploying this app to Vercel.
- [.agents/skills/vercel-cli-with-tokens/SKILL.md](.agents/skills/vercel-cli-with-tokens/SKILL.md) — non-interactive Vercel CLI with access tokens.
- [.agents/skills/shadcn/SKILL.md](.agents/skills/shadcn/SKILL.md) — adding, composing, or debugging shadcn/ui components.
- [.agents/skills/vercel-composition-patterns/SKILL.md](.agents/skills/vercel-composition-patterns/SKILL.md) — React composition patterns (compound components, avoiding boolean prop sprawl).
- [.agents/skills/vercel-react-best-practices/SKILL.md](.agents/skills/vercel-react-best-practices/SKILL.md) — React/Next.js performance guidelines.
- [.agents/skills/vercel-react-view-transitions/SKILL.md](.agents/skills/vercel-react-view-transitions/SKILL.md) — React View Transition API for route/element animations.
- [.agents/skills/vercel-react-native-skills/SKILL.md](.agents/skills/vercel-react-native-skills/SKILL.md) — React Native / Expo guidance (rarely relevant here).
- [.agents/skills/web-design-guidelines/SKILL.md](.agents/skills/web-design-guidelines/SKILL.md) — UI / accessibility / UX review checklist.
