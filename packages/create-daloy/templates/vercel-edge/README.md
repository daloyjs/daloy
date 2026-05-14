# my-daloy-vercel-api

A [DaloyJS](https://daloyjs.dev) Vercel Edge API starter.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Try it:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/books/1
```

## Deploy

```bash
pnpm deploy
```

The API entry lives at `api/[...path].ts` and uses `@daloyjs/core/vercel`:

```ts
export const config = { runtime: "edge" };
export default toEdgeHandler(app);
```

That catch-all API route lets DaloyJS own routing while Vercel handles the Edge runtime.
