import assert from "node:assert/strict";
import { test } from "node:test";

import { extractApiProperties, parseTsDoc, readApiProperties } from "../../lib/api-types";

const SOURCE = `
/** Options. */
export interface Opts {
  /** Window in ms, see {@link Other.x} and {@link "./x.js".y | the y helper}. */
  windowMs: number;
  /**
   * Store backend.
   *
   * Second paragraph.
   * @default memory
   * @since 1.2.0
   */
  store?: Store;
  /** @deprecated use store */
  legacy?: boolean;
  handler(ctx: Ctx, n: number): Promise<void>;
}
export type Alias = { a?: string };
`;

test("extractApiProperties reads names, types, optionality and TSDoc tags", () => {
  const props = extractApiProperties(SOURCE, "Opts");
  assert.deepEqual(props.map((p) => [p.name, p.type, p.required]), [
    ["windowMs", "number", true],
    ["store", "Store", false],
    ["legacy", "boolean", false],
    ["handler", "(ctx: Ctx, n: number) => Promise<void>", true],
  ]);
  assert.equal(props[0]!.description, "Window in ms, see `Other.x` and the y helper.");
  assert.equal(props[1]!.description, "Store backend.\n\nSecond paragraph.");
  assert.equal(props[1]!.default, "memory");
  assert.equal(props[1]!.since, "1.2.0");
  assert.equal(props[2]!.deprecated, "use store");
});

test("extractApiProperties supports object type aliases and rejects unknown names", () => {
  assert.deepEqual(extractApiProperties(SOURCE, "Alias").map((p) => p.name), ["a"]);
  assert.throws(() => extractApiProperties(SOURCE, "Missing", "x.ts"), /no interface or object type "Missing" in x\.ts/);
});

test("readApiProperties refuses paths outside the repository", async () => {
  await assert.rejects(readApiProperties("../../etc/passwd", "X"), /outside the repository/);
});

test("readApiProperties reads the real framework source", async () => {
  const props = await readApiProperties("src/middleware.ts", "RateLimitOptions");
  const names = props.map((p) => p.name);
  assert.ok(names.includes("windowMs") && names.includes("trustedProxies"));
  assert.equal(props.find((p) => p.name === "windowMs")?.required, true);
});

test("parseTsDoc keeps the first occurrence of repeated tags", () => {
  assert.equal(parseTsDoc("* a\n * @since 1\n * @since 2").tags.get("since"), "1");
});
