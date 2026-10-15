import { test, mock } from "node:test";
import assert from "node:assert/strict";

// `getDocPage` calls `cacheLife()` from `next/cache`, which throws outside the
// Next.js runtime. Stub it before importing the module under test.
mock.module("next/cache", {
  namedExports: { cacheLife: () => {}, cacheTag: () => {} },
});

const { renderPathMarkdown, resolveSafeOrigin } =
  await import("../../lib/render-page-markdown");
const { SITE_URL } = await import("../../lib/seo");

const LOCAL = "http://localhost:3000";
const PAGE_HTML = "<html><body><main><h1>Contact</h1><p>Hi.</p></main></body></html>";

/** Replace global fetch for one test, recording every requested URL. */
function stubFetch(t: { after: (fn: () => void) => void }, respond: (url: string) => Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}

test("[happy] resolveSafeOrigin keeps a loopback origin outside production", () => {
  assert.equal(resolveSafeOrigin(LOCAL), LOCAL);
  assert.equal(resolveSafeOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
});

test("[unhappy] resolveSafeOrigin pins forged and production-loopback origins to SITE_URL", (t) => {
  assert.equal(resolveSafeOrigin("https://evil.example"), SITE_URL);
  assert.equal(resolveSafeOrigin("not a url"), SITE_URL);

  const previous = process.env.NODE_ENV;
  t.after(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  });
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  assert.equal(resolveSafeOrigin("http://localhost:6379"), SITE_URL);
});

test("[happy] the HTML self-fetch follows a same-origin redirect", async (t) => {
  const calls = stubFetch(t, (url) =>
    url.endsWith("/contact")
      ? new Response(null, { status: 308, headers: { location: "/contact/" } })
      : new Response(PAGE_HTML, { status: 200, headers: { "content-type": "text/html" } }),
  );
  const result = await renderPathMarkdown(LOCAL, "/contact");
  assert.equal(result.status, 200);
  assert.match(result.markdown, /Contact/);
  assert.deepEqual(calls, [`${LOCAL}/contact`, `${LOCAL}/contact/`]);
});

test("[unhappy] the HTML self-fetch never follows a redirect off the pinned origin", async (t) => {
  const calls = stubFetch(t, () =>
    new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }),
  );
  const result = await renderPathMarkdown(LOCAL, "/privacy");
  assert.equal(result.status, 404);
  assert.deepEqual(calls, [`${LOCAL}/privacy`], "the off-origin hop must never be requested");
});

test("[unhappy] unknown marketing paths 404 without any self-fetch", async (t) => {
  const calls = stubFetch(t, () => new Response(PAGE_HTML));
  const result = await renderPathMarkdown(LOCAL, "/not-a-real-page");
  assert.equal(result.status, 404);
  assert.deepEqual(calls, []);
});
