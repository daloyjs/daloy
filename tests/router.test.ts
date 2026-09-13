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

test("wildcard registration preserves methods and rejects duplicates and name conflicts", () => {
  const router = new Router<string>();
  router.add("GET", "/assets/*path", "read");
  router.add("POST", "/assets/*path", "write");

  assert.equal(router.find("GET", "/assets/app.css")?.handler, "read");
  assert.equal(router.find("POST", "/assets/app.css")?.handler, "write");
  assert.deepEqual(router.allowedMethods("/assets/app.css").sort(), [
    "GET",
    "POST",
  ]);
  assert.throws(
    () => router.add("GET", "/assets/*path", "replacement"),
    /Duplicate route/,
  );
  assert.throws(
    () => router.add("DELETE", "/assets/*other", "delete"),
    /Conflicting.*names/,
  );
  assert.equal(router.find("GET", "/assets/app.css")?.handler, "read");
  assert.equal(router.find("DELETE", "/assets/app.css"), undefined);
});

test("conflicting param names at the same position throw", () => {
  const router = new Router<string>();
  router.add("GET", "/users/:id", "a");
  assert.throws(
    () => router.add("POST", "/users/:userId", "b"),
    /Conflicting param names/,
  );
});

test("allowedMethods works for static and dynamic paths", () => {
  const router = new Router<string>();
  router.add("GET", "/health", "getHealth");
  router.add("POST", "/users/:id", "updateUser");
  router.add("DELETE", "/users/:id", "deleteUser");

  assert.deepEqual(router.allowedMethods("/health"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/health/"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/health///"), []);
  assert.deepEqual(router.allowedMethods("/users/123").sort(), [
    "DELETE",
    "POST",
  ]);
});

test("path traversal and empty path segments are rejected", () => {
  const router = new Router<string>();
  router.add("GET", "/files/:name", "file");

  assert.equal(router.find("GET", "/files/../secret"), undefined);
  assert.equal(router.find("GET", "/files//secret"), undefined);
  assert.equal(router.find("GET", "/files/.."), undefined);
  assert.deepEqual(router.allowedMethods("/files/.."), []);
  assert.deepEqual(router.allowedMethods("/files//secret"), []);
});

test("incomplete trie prefixes do not shadow completed parameter or wildcard routes", () => {
  const router = new Router<string>();
  router.add("GET", "/users/me/details/:field", "details");
  router.add("GET", "/users/:id", "user");
  router.add("POST", "/files/:name/details", "details");
  router.add("GET", "/files/*path", "file");

  assert.deepEqual(router.find("GET", "/users/me"), {
    handler: "user",
    params: { id: "me" },
  });
  assert.deepEqual(router.find("GET", "/files/report"), {
    handler: "file",
    params: { path: "report" },
  });
  assert.deepEqual(router.allowedMethods("/users/me"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/files/report"), ["GET"]);
  assert.equal(router.find("GET", "/users"), undefined);
  assert.equal(router.find("GET", "/files"), undefined);
  assert.equal(router.find("GET", "/files/report/details"), undefined);
  assert.deepEqual(router.allowedMethods("/files/report/details"), ["POST"]);
});

test("nonterminal wildcards are rejected without broadening the routing table", () => {
  const router = new Router<string>();
  assert.throws(
    () => router.add("GET", "/files/*path/private", "bad", "files"),
    /terminal/,
  );
  assert.equal(router.find("GET", "/files/public"), undefined);
  assert.deepEqual(router.allowedMethods("/files/public"), []);
  router.add("GET", "/files/*path", "good", "files");
  assert.equal(router.find("GET", "/files/public")?.handler, "good");
});

test("failed registrations do not reserve operationIds", () => {
  const router = new Router<string>();
  router.add("GET", "/health", "health");
  router.add("GET", "/users/:id", "user");
  assert.throws(
    () => router.add("GET", "/health", "duplicate", "retry"),
    /Duplicate route/,
  );
  router.add("POST", "/health", "post", "retry");
  assert.throws(
    () => router.add("POST", "/users/:other", "conflict", "user"),
    /Conflicting/,
  );
  router.add("POST", "/users/:id", "post", "user");
  assert.throws(
    () => router.add("DELETE", "/health", "bad", "user"),
    /Duplicate operationId/,
  );
  assert.equal(router.find("DELETE", "/health"), undefined);
});

test("method discovery includes dynamic methods behind a static route", () => {
  const router = new Router<string>();
  router.add("GET", "/users/me", "me");
  router.add("GET", "/users/:id", "user");
  router.add("POST", "/users/:id", "update");

  assert.deepEqual(router.allowedMethods("/users/me"), ["GET", "POST"]);
  assert.deepEqual(router.allowedMethods("/users/me/"), ["GET", "POST"]);
  assert.equal(router.find("GET", "/users/me")?.handler, "me");
  assert.equal(router.find("POST", "/users/me")?.handler, "update");
  assert.equal(router.find("DELETE", "/users/me"), undefined);
});

test("invalid capture names fail before mutating the trie", () => {
  for (const path of [
    "/files/:",
    "/files/:id/:id",
    "/files/:id/*id",
    "/files/:__proto__",
    "/files/:constructor",
    "/files/:prototype",
    "/files/*__proto__",
    "/files/*constructor",
    "/files/*prototype",
  ]) {
    const router = new Router<string>();
    assert.throws(
      () => router.add("GET", path, "bad", "files"),
      /capture name/,
    );
    router.add("GET", "/files/:name", "good", "files");
    assert.deepEqual(router.find("GET", "/files/report"), {
      handler: "good",
      params: { name: "report" },
    });
  }
  const router = new Router<string>();
  router.add("GET", "/assets/*", "asset");
  assert.deepEqual(router.find("GET", "/assets/css/app.css")?.params, {
    wildcard: "css/app.css",
  });
});

test("falsy handlers remain matchable and cannot bypass duplicate detection", () => {
  for (const handler of [undefined, null, false, 0, ""]) {
    for (const path of ["/fixed", "/:id", "/*path"]) {
      const router = new Router<typeof handler>();
      router.add("GET", path, handler);
      const match = router.find("GET", "/fixed");
      assert.ok(match);
      assert.equal(match.handler, handler);
      assert.throws(() => router.add("GET", path, handler), /Duplicate route/);
      assert.deepEqual(router.allowedMethods("/fixed"), ["GET"]);
      assert.equal(router.find("POST", "/fixed"), undefined);
    }
  }
});

test("inherited method names never resolve as registered handlers", () => {
  for (const path of ["/fixed", "/:id", "/*path"]) {
    const router = new Router<string>();
    router.add("GET", path, "registered");
    for (const method of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "CUSTOM",
    ]) {
      assert.equal(
        router.find(method as Parameters<typeof router.find>[0], "/fixed"),
        undefined,
      );
    }
    assert.equal(router.find("GET", "/fixed")?.handler, "registered");
    assert.deepEqual(router.allowedMethods("/fixed"), ["GET"]);
  }
});

test("static-only method discovery stays fresh when routes are added", () => {
  const router = new Router<string>();
  assert.deepEqual(router.allowedMethods("/users/me"), []);
  router.add("GET", "/users/me", "me");
  const methods = router.allowedMethods("/users/me");
  assert.deepEqual(methods, ["GET"]);
  methods.push("DELETE");
  assert.deepEqual(router.allowedMethods("/users/me"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/users/me/"), ["GET"]);
  assert.deepEqual(router.allowedMethods("/users//me"), []);
  assert.deepEqual(router.allowedMethods("/users/.."), []);
  assert.deepEqual(router.allowedMethods("/missing"), []);
  assert.throws(
    () => router.add("POST", "/users/*path/private", "bad"),
    /terminal/,
  );
  assert.deepEqual(router.allowedMethods("/users/me"), ["GET"]);
  router.add("HEAD", "/users/me", "head");
  router.add("POST", "/users/:id", "update");
  assert.deepEqual(router.allowedMethods("/users/me"), ["GET", "HEAD", "POST"]);
  assert.deepEqual(router.allowedMethods("/users/other"), ["POST"]);
});

test("cached method discovery rejects invalid registered paths and follows new precedence", () => {
  const router = new Router<string>();
  for (const path of ["/bad/../path", "/bad//path", "/bad/.."]) {
    router.add("GET", path, "unreachable");
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.deepEqual(router.allowedMethods(path), []);
      assert.equal(router.find("GET", path), undefined);
    }
  }
  router.add("GET", "/users/me/details", "static");
  router.add("POST", "/users/*rest", "wildcard");
  assert.deepEqual(router.allowedMethods("/users/me/details"), ["GET", "POST"]);
  router.add("DELETE", "/users/:id/details", "parameter");
  assert.deepEqual(router.allowedMethods("/users/me/details"), [
    "GET",
    "DELETE",
  ]);
  assert.equal(router.find("POST", "/users/me/details"), undefined);
  assert.equal(
    router.find("DELETE", "/users/me/details")?.handler,
    "parameter",
  );
  assert.deepEqual(router.allowedMethods("/users/me/details//"), []);
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
