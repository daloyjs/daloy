import { serve } from "@daloyjs/core/bun";
import { printStartupBanner, type StartupBannerLink } from "@daloyjs/core/banner";
import { buildApp } from "./build-app.ts";

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

const handle = serve(app, {
  port,
  // Bun closes idle keep-alive connections after this many seconds.
  idleTimeout: 30,
});

// `handle.url` is a URL whose string form ends in "/"; use the origin so the
// links below do not become "//docs" (which 404s).
const url = handle.url ? handle.url.origin : `http://localhost:${port}`;
const links: StartupBannerLink[] = [
  // daloy-minimal:strip-start docs
  { label: "API docs", url: `${url}/docs` },
  { label: "OpenAPI JSON", url: `${url}/openapi.json` },
  { label: "OpenAPI YAML", url: `${url}/openapi.yaml` },
  // daloy-minimal:strip-end docs
  { label: "Health", url: `${url}/healthz` },
];

printStartupBanner({ name: "DaloyJS API", url, runtime: "Bun", links });

// NOTE: This module intentionally has no default export. Bun auto-starts a
// server from any module whose default-exported object has a `fetch` method,
// which would collide with the explicit `serve()` call above on the same port
// (EADDRINUSE) and crash on startup (Railway's "Uncaught exception" loop).
