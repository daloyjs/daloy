import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendVaryAccept,
  PAGE_PRODUCES,
  preferredType,
  shouldNegotiatePage,
} from "../../lib/accept";

test("missing Accept prefers HTML", () => {
  assert.equal(preferredType(null), "text/html");
});

test("Accept: text/markdown selects markdown", () => {
  assert.equal(preferredType("text/markdown"), "text/markdown");
});

test("markdown listed before html wins at equal q", () => {
  assert.equal(
    preferredType("text/markdown, text/html, */*"),
    "text/markdown",
  );
});

test("higher-q html beats earlier markdown", () => {
  assert.equal(
    preferredType("text/markdown;q=0.2, text/html;q=0.9"),
    "text/html",
  );
});

test("q=0 rejects that type even when a wildcard would match", () => {
  assert.equal(preferredType("text/html;q=0, */*;q=1"), "text/markdown");
});

test("unsatisfiable Accept returns null", () => {
  assert.equal(preferredType("application/pdf"), null);
  assert.equal(preferredType("application/json"), null);
});

test("appendVaryAccept keeps existing tokens and adds Accept", () => {
  const headers = new Headers({
    vary: "rsc, next-router-state-tree",
  });
  appendVaryAccept(headers);
  const vary = headers.get("vary") ?? "";
  assert.match(vary, /rsc/i);
  assert.match(vary, /Accept/);
  assert.match(vary, /Accept-Encoding/);
});

test("appendVaryAccept is idempotent for Accept", () => {
  const headers = new Headers();
  appendVaryAccept(headers);
  appendVaryAccept(headers);
  const tokens = (headers.get("vary") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  assert.equal(tokens.filter((token) => token === "accept").length, 1);
});

test("API and markdown handler paths skip page negotiation", () => {
  assert.equal(shouldNegotiatePage("/mcp"), false);
  assert.equal(shouldNegotiatePage("/api"), false);
  assert.equal(shouldNegotiatePage("/api/v1"), false);
  assert.equal(shouldNegotiatePage("/md/about"), false);
  assert.equal(shouldNegotiatePage("/openapi.json"), false);
  assert.equal(shouldNegotiatePage("/llms.txt"), false);
  assert.equal(shouldNegotiatePage("/docs/llms.txt"), false);
  assert.equal(shouldNegotiatePage("/.well-known/api-catalog"), false);
  assert.equal(shouldNegotiatePage("/docs/routing"), true);
  assert.equal(shouldNegotiatePage("/about"), true);
});

test("PAGE_PRODUCES is html then markdown", () => {
  assert.deepEqual([...PAGE_PRODUCES], ["text/html", "text/markdown"]);
});
