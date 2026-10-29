import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isNonEnglishSearch,
  NON_ENGLISH_SEARCH_EVENT,
  queryScript,
  recordNonEnglishSearch,
  type NonEnglishSearchSignal,
} from "../../lib/search-metrics";
import { glossaryMatches } from "../../lib/docs-glossary";

const SIGNAL: NonEnglishSearchSignal = {
  script: "han",
  englishResults: "some",
  englishResultsWithoutGlossary: "none",
  translatedResults: "some",
  glossaryTerms: 1,
};

test("queryScript classifies coarsely", () => {
  assert.equal(queryScript("限流"), "han");
  assert.equal(queryScript("validación"), "latin");
  assert.equal(queryScript("rate limit"), "latin");
  assert.equal(queryScript("123 !!"), "other");
});

test("only non-ASCII or glossary-matched searches count as non-English", () => {
  assert.equal(isNonEnglishSearch("rate limit", glossaryMatches("rate limit")), false);
  assert.equal(isNonEnglishSearch("限流", []), true);
  assert.equal(isNonEnglishSearch("validación", []), true);
  assert.equal(isNonEnglishSearch("pruebas", glossaryMatches("pruebas")), true);
});

/** Run `fn` with env overrides and a recording fetch; restore both after. */
async function withProductionFetch(
  env: Record<string, string | undefined>,
  fn: () => void,
): Promise<Array<{ url: string; init: RequestInit }>> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("ok");
  }) as typeof fetch;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return calls;
}

test("nothing is sent outside the production deployment", async () => {
  for (const env of ["preview", "development", undefined]) {
    const calls = await withProductionFetch({ VERCEL_ENV: env, VERCEL_URL: "daloyjs.dev" }, () =>
      recordNonEnglishSearch(SIGNAL),
    );
    assert.equal(calls.length, 0, String(env));
  }
});

test("in production only the aggregate signal is sent: no IP, no cookie, no query", async () => {
  const calls = await withProductionFetch(
    { VERCEL_ENV: "production", VERCEL_URL: "daloyjs.dev", VERCEL_WEB_ANALYTICS_DISABLE_LOGS: "1" },
    () => recordNonEnglishSearch(SIGNAL),
  );
  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get("user-agent"), "daloyjs-docs-mcp-counter");
  for (const name of ["x-vercel-ip", "cookie"]) {
    const value = headers.get(name);
    assert.ok(value === null || value === "undefined" || value === "", `${name}: ${value}`);
  }
  const body = JSON.parse(String(calls[0]!.init.body)) as { en: string; ed: Record<string, unknown> };
  assert.equal(body.en, NON_ENGLISH_SEARCH_EVENT);
  assert.deepEqual(Object.keys(body.ed).sort(), Object.keys(SIGNAL).sort());
});

test("a failing analytics call never throws into the search", async () => {
  const original = globalThis.fetch;
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_URL = "daloyjs.dev";
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
  try {
    assert.doesNotThrow(() => recordNonEnglishSearch(SIGNAL));
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = original;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_URL;
  }
});
