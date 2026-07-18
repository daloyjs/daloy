import { test } from "node:test";
import assert from "node:assert/strict";

import { safeRedirect, OpenRedirectBlockedError } from "../src/index.js";

// ============================================================
// Happy paths
// ============================================================

test("safeRedirect: allows a path in allowedPaths and defaults to 303 + no-store", () => {
  const res = safeRedirect("/dashboard", { allowedPaths: ["/dashboard"] });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/dashboard");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("safeRedirect: preserves query string when path matches", () => {
  const res = safeRedirect("/dashboard?tab=1#x", { allowedPaths: ["/dashboard"] });
  assert.equal(res.headers.get("Location"), "/dashboard?tab=1#x");
});

test("safeRedirect: `/*` wildcard allows any same-origin path", () => {
  const res = safeRedirect("/anything/under/the/sun", { allowedPaths: ["/*"] });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/anything/under/the/sun");
});

test("safeRedirect: absolute URL with matching origin is allowed", () => {
  const res = safeRedirect("https://app.example.com/x", {
    allowedOrigins: ["https://app.example.com"],
  });
  assert.equal(res.headers.get("Location"), "https://app.example.com/x");
});

test("safeRedirect: honors custom status and merges extra headers", () => {
  const res = safeRedirect("/x", {
    allowedPaths: ["/x"],
    status: 308,
    headers: { "X-Trace": "abc" },
  });
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("X-Trace"), "abc");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("safeRedirect: caller-provided Cache-Control is not overwritten", () => {
  const res = safeRedirect("/x", {
    allowedPaths: ["/x"],
    headers: { "Cache-Control": "private, max-age=0" },
  });
  assert.equal(res.headers.get("Cache-Control"), "private, max-age=0");
});

test("safeRedirect: falls back when target is rejected", () => {
  const res = safeRedirect("//evil.com", {
    allowedPaths: ["/", "/dashboard"],
    fallback: "/",
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/");
});

// ============================================================
// Unhappy paths — the actual open-redirect attack vectors
// ============================================================

test("safeRedirect: refuses protocol-relative `//evil.com`", () => {
  assert.throws(
    () => safeRedirect("//evil.com", { allowedPaths: ["/"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "protocol-relative",
  );
});

test("safeRedirect: refuses `/\\evil.com` backslash bypass", () => {
  assert.throws(
    () => safeRedirect("/\\evil.com", { allowedPaths: ["/"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "backslash-path",
  );
});

test("safeRedirect: refuses backslashes embedded in same-origin paths", () => {
  assert.throws(
    () => safeRedirect("/foo\\bar", { allowedPaths: ["/*"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "backslash-path",
  );
});

test("safeRedirect: refuses encoded backslash paths before wildcard matching", () => {
  for (const target of ["/%5cevil.com", "/%5C%5Cevil.com", "/foo%5cbar"]) {
    assert.throws(
      () => safeRedirect(target, { allowedPaths: ["/*"] }),
      (err: unknown) =>
        err instanceof OpenRedirectBlockedError && err.reason === "backslash-path",
    );
  }
});

test("safeRedirect: refuses encoded protocol-relative paths before wildcard matching", () => {
  for (const target of ["/%2f%2fevil.com", "/%2F%2Fevil.com", "/%252f%252fevil.com"]) {
    assert.throws(
      () => safeRedirect(target, { allowedPaths: ["/*"] }),
      (err: unknown) =>
        err instanceof OpenRedirectBlockedError && err.reason === "protocol-relative",
    );
  }
});

test("safeRedirect: refuses CR/LF response-splitting payloads", () => {
  assert.throws(
    () =>
      safeRedirect("/ok\r\nSet-Cookie: pwn=1", { allowedPaths: ["/*"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError &&
      err.reason === "invalid-control-characters",
  );
});

test("safeRedirect: refuses non-Latin1 same-origin paths with a typed error (not a raw TypeError)", () => {
  // Regression: a `/`-prefixed target carrying a code point above U+00FF used
  // to sail past the control-char check, match the `/*` allowlist, and then
  // throw a raw `TypeError` from `Headers.set("Location", …)` (ByteString
  // conversion) — which the documented try/catch rethrows as an uncaught 500.
  // Includes the Unicode slash homographs U+2044 (⁄), U+FF0F (／), U+2215 (∕).
  for (const target of ["/⁄evil.example", "/／evil.example", "/∕evil.example", "/x€y"]) {
    let thrown: unknown;
    try {
      safeRedirect(target, { allowedPaths: ["/*"], allowedOrigins: ["https://app.example.com"] });
      assert.fail(`expected safeRedirect(${JSON.stringify(target)}) to throw`);
    } catch (e) {
      thrown = e;
    }
    assert.ok(
      thrown instanceof OpenRedirectBlockedError,
      `expected OpenRedirectBlockedError, got ${(thrown as Error)?.constructor?.name}`,
    );
    assert.equal((thrown as OpenRedirectBlockedError).reason, "non-latin1-target");
    assert.ok(!(thrown instanceof TypeError));
  }
});

test("safeRedirect: still allows ordinary Latin-1 (ASCII) same-origin paths", () => {
  // Guard against over-blocking: the fix must only reject code points > U+00FF.
  const res = safeRedirect("/dashboard?tab=1", { allowedPaths: ["/*"] });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/dashboard?tab=1");
});

test("safeRedirect: refuses `javascript:` even if origin allowlist is empty", () => {
  assert.throws(
    () => safeRedirect("javascript:alert(1)", { allowedOrigins: [] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "scheme-not-allowed",
  );
});

test("safeRedirect: refuses absolute URLs whose origin is not allowlisted", () => {
  assert.throws(
    () =>
      safeRedirect("https://evil.com/path", {
        allowedOrigins: ["https://app.example.com"],
      }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "origin-not-allowed",
  );
});

test("safeRedirect: refuses a same-origin path not in allowedPaths", () => {
  assert.throws(
    () => safeRedirect("/admin", { allowedPaths: ["/dashboard"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "path-not-allowed",
  );
});

test("safeRedirect: refuses empty target", () => {
  assert.throws(
    () => safeRedirect("", { allowedPaths: ["/*"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "empty-target",
  );
});

test("safeRedirect: refuses unparseable absolute targets", () => {
  assert.throws(
    () => safeRedirect("http://", { allowedOrigins: ["https://app.example.com"] }),
    (err: unknown) =>
      err instanceof OpenRedirectBlockedError && err.reason === "parse-failed",
  );
});

test("safeRedirect: refuses non-redirect status codes", () => {
  assert.throws(
    () =>
      safeRedirect("/x", {
        allowedPaths: ["/x"],
        status: 200 as unknown as 303,
      }),
    /not a redirect status/,
  );
});

test("safeRedirect: refuses allowedPaths entries that don't start with `/`", () => {
  assert.throws(
    () => safeRedirect("/x", { allowedPaths: ["dashboard"] }),
    /must start with "\/"/,
  );
});

test("safeRedirect: refuses allowedOrigins entries with a path component", () => {
  assert.throws(
    () =>
      safeRedirect("/x", {
        allowedPaths: ["/x"],
        allowedOrigins: ["https://app.example.com/with/path"],
      }),
    /bare origin/,
  );
});

test("safeRedirect: refuses allowedOrigins entries that aren't valid URLs", () => {
  assert.throws(
    () => safeRedirect("/x", { allowedPaths: ["/x"], allowedOrigins: ["not a url"] }),
    /not a valid URL/,
  );
});

test("safeRedirect: refuses fallback that isn't a same-origin path", () => {
  assert.throws(
    () =>
      safeRedirect("https://evil.com", {
        allowedOrigins: ["https://app.example.com"],
        fallback: "https://evil.com",
      }),
    /fallback must be a same-origin path/,
  );
});

test("safeRedirect: refuses protocol-relative fallback", () => {
  assert.throws(
    () =>
      safeRedirect("https://evil.com", {
        allowedOrigins: ["https://app.example.com"],
        fallback: "//evil.com",
      }),
    /fallback must be a same-origin path/,
  );
});

test("OpenRedirectBlockedError: carries reason and target for logging", () => {
  try {
    safeRedirect("//evil.com", { allowedPaths: ["/"] });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof OpenRedirectBlockedError);
    assert.equal(err.reason, "protocol-relative");
    assert.equal(err.target, "//evil.com");
    assert.equal(err.name, "OpenRedirectBlockedError");
  }
});
