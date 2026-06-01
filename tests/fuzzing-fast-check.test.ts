import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  isForbiddenObjectKey,
  safeJsonParse,
  sanitizeHeaderValue,
} from "../src/index.js";

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

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
      fc.dictionary(
        fc.constantFrom("__proto__", "constructor", "prototype", "ok"),
        jsonSafeValue,
        { maxKeys: 4 }
      ),
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
