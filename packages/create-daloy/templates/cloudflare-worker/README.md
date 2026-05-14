# my-daloy-worker

A [DaloyJS](https://daloyjs.dev) Cloudflare Workers starter.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:8787
```

## Deploy

```bash
pnpm deploy
```

`@daloyjs/core/cloudflare` exposes `toFetchHandler(app)`, so the same `App` you would use on Node also runs on Workers.
