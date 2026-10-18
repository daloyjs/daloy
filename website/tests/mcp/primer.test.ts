import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Tests for the DaloyJS primer in the MCP server instructions. Most MCP
 * clients put the instructions in the model's system prompt, so a model with
 * no training-time knowledge of DaloyJS learns the framework from this text.
 * A wrong link or a code sample that no longer runs would teach every such
 * model the wrong thing, so both are checked against the real docs corpus and
 * the real framework source.
 *
 * `next/cache` is stubbed for the same reason as tests/mcp/route.test.ts.
 */
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { SITE_MCP_INSTRUCTIONS } = await import("../../lib/site-mcp");
const { getDocPage } = await import("../../lib/docs-content");

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const WEBSITE_ROOT = resolve(import.meta.dirname, "../..");

/** The single fenced `ts` code sample in the primer. */
function primerCode(): string {
  const match = /```ts\n([\s\S]*?)\n```/.exec(SITE_MCP_INSTRUCTIONS);
  assert.ok(match, "primer must contain a ```ts code sample");
  return match[1];
}

test("[happy] the primer covers what it is, scaffolding, the idiom, mistakes, and reading order", () => {
  assert.match(SITE_MCP_INSTRUCTIONS, /contract-first TypeScript web framework/);
  assert.match(SITE_MCP_INSTRUCTIONS, /pnpm create daloy@latest/);
  assert.match(SITE_MCP_INSTRUCTIONS, /Common mistakes/);
  assert.match(SITE_MCP_INSTRUCTIONS, /no `res\.json\(\)`/);
  assert.match(SITE_MCP_INSTRUCTIONS, /Start reading: \/docs\/getting-started/);
  // Clients resend the instructions on every turn; keep the primer small.
  assert.ok(
    SITE_MCP_INSTRUCTIONS.length < 4_000,
    `instructions are ${SITE_MCP_INSTRUCTIONS.length} chars; keep them under 4000`
  );
});

test("[happy] every docs route the primer points at exists", async () => {
  const routes = [...new Set(SITE_MCP_INSTRUCTIONS.match(/\/docs\/[a-z0-9/-]*[a-z0-9]/g) ?? [])];
  assert.ok(routes.length >= 5, "primer should name the core reading list");
  for (const route of routes) {
    assert.ok(await getDocPage(route), `primer links ${route}, which is not a docs page`);
  }
});

test("[unhappy] the route check would catch a broken primer link", async () => {
  assert.equal(await getDocPage("/docs/getting-startd"), null);
});

test("[happy] the primer's code sample runs against the framework source", async (t) => {
  const source = primerCode()
    .replace('"@daloyjs/core/node"', JSON.stringify(pathToFileURL(join(REPO_ROOT, "src/adapters/node.ts")).href))
    .replace('"@daloyjs/core"', JSON.stringify(pathToFileURL(join(REPO_ROOT, "src/index.ts")).href))
    .replace(/^serve\(app, \{ port: 3000 \}\);$/m, "void serve;\nexport { app };");
  assert.match(source, /export \{ app \}/, "the sample must end with serve(app, { port: 3000 })");

  // Inside website/node_modules so the sample's `zod` import resolves.
  const dir = await mkdtemp(join(WEBSITE_ROOT, "node_modules", ".mcp-primer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "primer.ts");
  await writeFile(file, source);

  const { app } = await import(pathToFileURL(file).href);
  const ok = await app.request("/greet/world");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { msg: "Hello, world!" });

  // Unhappy: an undeclared route is still rejected by the sample app.
  const missing = await app.request("/nope");
  assert.equal(missing.status, 404);
});
