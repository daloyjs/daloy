import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { isForbiddenObjectKey, safeJsonParse, sanitizeHeaderValue } from "../src/index.js";
import { sanitizeFilename, assertSafeRelativePath, sanitizeHeaderName } from "../src/security.js";
import { parseIp, compileCidrMatcher, matchesMatcher } from "../src/ip-restriction.js";

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

const octet = fc.integer({ min: 0, max: 255 });
const ipv4 = fc.tuple(octet, octet, octet, octet).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
const safeSegment = fc
  .array(fc.constantFrom(..."abcXYZ012_-".split("")), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(""));

test("fuzz: isForbiddenObjectKey matches the exact forbidden-key set", () => {
  fc.assert(
    fc.property(fc.string(), (key) => {
      assert.equal(isForbiddenObjectKey(key), FORBIDDEN.has(key));
    }),
    { numRuns: 500 }
  );
});

test("fuzz: safeJsonParse strips dangerous object keys at any depth", () => {
  const jsonSafeValue = fc.letrec((tie) => ({
    value: fc.oneof(
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string(),
      fc.constant(null),
      fc.array(tie("value"), { maxLength: 4 }),
      fc.dictionary(fc.string(), tie("value"), { maxKeys: 6 })
    ),
  })).value;

  fc.assert(
    fc.property(
      fc.dictionary(fc.constantFrom("__proto__", "constructor", "prototype", "ok"), jsonSafeValue, {
        maxKeys: 4,
      }),
      (obj) => {
        const parsed = safeJsonParse(JSON.stringify(obj));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          assert.equal(Object.hasOwn(parsed, "__proto__"), false);
          assert.equal(Object.hasOwn(parsed, "constructor"), false);
          assert.equal(Object.hasOwn(parsed, "prototype"), false);
        }
      }
    ),
    { numRuns: 250 }
  );
});

test("fuzz: sanitizeHeaderValue accepts only values without CR/LF/NUL", () => {
  fc.assert(
    fc.property(fc.string(), (value) => {
      const shouldReject = /[\r\n\0]/.test(value);
      if (shouldReject) {
        assert.throws(() => sanitizeHeaderValue(value));
      } else {
        assert.equal(sanitizeHeaderValue(value), value);
      }
    }),
    { numRuns: 500 }
  );
});

// --- IP / CIDR parsing — feeds fetchGuard's SSRF allow/deny decisions, so a
// parser bug here is a security bug. These were example-only before. ---

test("fuzz: parseIp accepts well-formed IPv4 and rejects out-of-range octets", () => {
  fc.assert(
    fc.property(ipv4, (ip) => {
      assert.notEqual(parseIp(ip), undefined);
    }),
    { numRuns: 500 }
  );
  fc.assert(
    fc.property(
      fc.tuple(octet, octet, octet, fc.integer({ min: 256, max: 100000 })),
      ([a, b, c, bad]) => {
        assert.equal(parseIp(`${a}.${b}.${c}.${bad}`), undefined);
      }
    ),
    { numRuns: 300 }
  );
});

test("fuzz: an IPv4 always matches its own /32 and the /0 supernet, never a foreign /32", () => {
  fc.assert(
    fc.property(ipv4, ipv4, (ip, other) => {
      const self = parseIp(ip);
      assert.notEqual(self, undefined);
      assert.equal(matchesMatcher(self!, compileCidrMatcher(`${ip}/32`)), true);
      assert.equal(matchesMatcher(self!, compileCidrMatcher("0.0.0.0/0")), true);
      // ipv4 strings have no leading zeros, so distinct strings = distinct IPs.
      if (other !== ip) {
        assert.equal(matchesMatcher(self!, compileCidrMatcher(`${other}/32`)), false);
      }
    }),
    { numRuns: 400 }
  );
});

test("fuzz: /24 containment — same first three octets match, a neighbouring /24 does not", () => {
  fc.assert(
    fc.property(octet, octet, fc.integer({ min: 0, max: 254 }), octet, octet, (a, b, c, d1, d2) => {
      const net = compileCidrMatcher(`${a}.${b}.${c}.0/24`);
      assert.equal(matchesMatcher(parseIp(`${a}.${b}.${c}.${d1}`)!, net), true);
      assert.equal(matchesMatcher(parseIp(`${a}.${b}.${c}.${d2}`)!, net), true);
      // c <= 254, so c+1 is a valid, different third octet → outside the /24.
      assert.equal(matchesMatcher(parseIp(`${a}.${b}.${c + 1}.${d1}`)!, net), false);
    }),
    { numRuns: 400 }
  );
});

// --- Path / filename / header-name sanitizers ---

test("fuzz: sanitizeFilename never returns a path separator or '..'", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      let out: string;
      try {
        out = sanitizeFilename(s);
      } catch {
        return; // refusing the input is an acceptable outcome
      }
      assert.doesNotMatch(out, /[/\\\0]/, `leaked a separator: ${JSON.stringify(out)}`);
      assert.notEqual(out, "..");
    }),
    { numRuns: 500 }
  );
});

test("fuzz: sanitizeHeaderName returns a lowercase token with no CR/LF/NUL/space, or throws", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      let out: string;
      try {
        out = sanitizeHeaderName(s);
      } catch {
        return;
      }
      assert.equal(out, out.toLowerCase());
      assert.doesNotMatch(out, /[\r\n\0 ]/);
    }),
    { numRuns: 500 }
  );
});

test("fuzz: assertSafeRelativePath rejects absolute/traversal prefixes, echoes safe paths", () => {
  // Reject side: an absolute or parent-traversal prefix must always throw.
  fc.assert(
    fc.property(fc.constantFrom("../", "/"), safeSegment, (bad, rest) => {
      assert.throws(() => assertSafeRelativePath(bad + rest));
    }),
    { numRuns: 200 }
  );
  // Accept side: a path built only from safe segments is returned unchanged.
  fc.assert(
    fc.property(fc.array(safeSegment, { minLength: 1, maxLength: 4 }), (segs) => {
      const p = segs.join("/");
      assert.equal(assertSafeRelativePath(p), p);
    }),
    { numRuns: 300 }
  );
});
