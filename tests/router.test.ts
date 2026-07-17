import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../src/router.js";

test("static routes take precedence over param routes", () => {
  const router = new Router<string>();
  router.add("GET", "/users/:id", "param");
  router.add("GET", "/users/me", "static");

  assert.equal(router.find("GET", "/users/me")?.handler, "static");
  assert.equal(router.find("GET", "/users/123")?.handler, "param");
});

test("dynamic params are decoded and trailing slashes normalize", () => {
  const router = new Router<string>();
  router.add("GET", "/files/:name", "file");

  const match = router.find("GET", "/files/report%202024/");
  assert.equal(match?.handler, "file");
  assert.deepEqual(match?.params, { name: "report 2024" });
});

test("unencoded dynamic and wildcard params preserve their values", () => {
  const router = new Router<string>();
  router.add("GET", "/files/:name", "file");
  router.add("GET", "/assets/*path", "asset");

  assert.deepEqual(router.find("GET", "/files/report+2024")?.params, {
    name: "report+2024",
  });
  assert.deepEqual(router.find("GET", "/assets/css/app.css")?.params, {
    path: "css/app.css",
  });
});

test("wildcard routes capture remaining segments", () => {
  const router = new Router<string>();
  router.add("GET", "/assets/*path", "asset");

  const match = router.find("GET", "/assets/css/app.css");
  assert.equal(match?.handler, "asset");
  assert.deepEqual(match?.params, { path: "css/app.css" });
});

test("duplicate routes throw", () => {
  const router = new Router<string>();
  router.add("GET", "/x", "a");
  assert.throws(() => router.add("GET", "/x", "b"), /Duplicate route/);
});

test("conflicting param names at the same position throw", () => {
  const router = new Router<string>();
  router.add("GET", "/users/:id", "a");
  assert.throws(() => router.add("POST", "/users/:userId", "b"), /Conflicting param names/);
});

test("allowedMethods works for static and dynamic paths", () => {
  const router = new Router<string>();
  router.add("GET", "/health", "getHealth");
  router.add("POST", "/users/:id", "updateUser");
  router.add("DELETE", "/users/:id", "deleteUser");

  assert.deepEqual(router.allowedMethods("/health"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/health///"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/users/123").sort(), ["DELETE", "POST"]);
});

test("path traversal and empty path segments are rejected", () => {
  const router = new Router<string>();
  router.add("GET", "/files/:name", "file");

  assert.equal(router.find("GET", "/files/../secret"), undefined);
  assert.equal(router.find("GET", "/files//secret"), undefined);
  assert.equal(router.find("GET", "/files/.."), undefined);
});

test("malformed percent-escapes miss cleanly instead of throwing", () => {
  const router = new Router<string>();
  router.add("GET", "/files/:name", "file");
  router.add("GET", "/assets/*path", "asset");

  // A lone or invalid percent-escape would make decodeURIComponent throw a
  // URIError; the router must swallow it and report no match (clean 404).
  assert.doesNotThrow(() => router.find("GET", "/files/%zz"));
  assert.equal(router.find("GET", "/files/%zz"), undefined);
  assert.equal(router.find("GET", "/files/%"), undefined);
  // Wildcard tails with a malformed segment must also miss without throwing.
  assert.doesNotThrow(() => router.find("GET", "/assets/css/%e0%a4%a"));
  assert.equal(router.find("GET", "/assets/css/%e0%a4%a"), undefined);
  // allowedMethods walks the same trie and must not throw either.
  assert.doesNotThrow(() => router.allowedMethods("/files/%zz"));
  assert.deepEqual(router.allowedMethods("/files/%zz"), []);
});
