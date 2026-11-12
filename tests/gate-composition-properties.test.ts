/**
 * Property tests for hook composition: random trees of `every()` / `some()`
 * over simple gates are checked against a reference model.
 *
 * Hand-written cases only cover the compositions someone thought of, and the
 * composition bugs found so far were all in shapes nobody had written down.
 * These tests generate the shapes instead. The generator is seeded, so a
 * failure prints the seed and the tree and can be replayed exactly.
 *
 * Properties, for every generated tree and credential set:
 *  1. Admission matches the model: `every` is AND, `some` is OR. A request
 *     the model denies never reaches the handler.
 *  2. No identity leaks: the state the handler sees is exactly what the
 *     gates on the winning path wrote, never a denied branch's.
 *  3. A stored response is never replayed to a request the model denies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  every,
  httpSignatureAuth,
  markAuthHook,
  responseCache,
  some,
  UnauthorizedError,
  type Hooks,
} from "../src/index.js";

/** Small deterministic PRNG (mulberry32) so failures are replayable by seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tree =
  | { kind: "pre"; id: number }
  | { kind: "before"; id: number }
  | { kind: "every"; children: Tree[] }
  | { kind: "some"; children: Tree[] };

const LEAVES = 5;

function genTree(rand: () => number, depth: number, phases: readonly ("pre" | "before")[]): Tree {
  if (depth === 0 || rand() < 0.35) {
    return {
      kind: phases[Math.floor(rand() * phases.length)]!,
      id: Math.floor(rand() * LEAVES),
    };
  }
  const width = 2 + Math.floor(rand() * 2);
  return {
    kind: rand() < 0.5 ? "every" : "some",
    children: Array.from({ length: width }, () => genTree(rand, depth - 1, phases)),
  };
}

function show(tree: Tree): string {
  return tree.kind === "pre" || tree.kind === "before"
    ? `${tree.kind}(${tree.id})`
    : `${tree.kind}(${tree.children.map(show).join(", ")})`;
}

/** Build the real hooks for a tree. Each leaf passes on `x-k<id>: ok` and records `m<id>`. */
function build(tree: Tree): Hooks {
  if (tree.kind === "every") return every(...tree.children.map(build));
  if (tree.kind === "some") return some(...tree.children.map(build));
  const { id } = tree;
  const gate = (ctx: { request: Request; state: Record<string, unknown> }) => {
    if (ctx.request.headers.get(`x-k${id}`) !== "ok") throw new UnauthorizedError();
    ctx.state[`m${id}`] = true;
  };
  return tree.kind === "pre"
    ? markAuthHook({ preBody: gate } as never)
    : ({ beforeHandle: gate } as never);
}

/** Reference model: which marks the winning path writes, or `null` when denied. */
function model(tree: Tree, creds: ReadonlySet<number>): Set<number> | null {
  if (tree.kind === "pre" || tree.kind === "before") {
    return creds.has(tree.id) ? new Set([tree.id]) : null;
  }
  if (tree.kind === "every") {
    const marks = new Set<number>();
    for (const child of tree.children) {
      const result = model(child, creds);
      if (result === null) return null;
      for (const mark of result) marks.add(mark);
    }
    return marks;
  }
  for (const child of tree.children) {
    const result = model(child, creds);
    if (result !== null) return result;
  }
  return null;
}

function appFor(tree: Tree, withCache: boolean): { app: App; calls: () => number } {
  const app = new App({ logger: false, behindProxy: "none" } as never);
  let calls = 0;
  if (withCache) app.use(responseCache({ principal: () => "one-principal" } as never));
  app.route({
    method: "GET",
    path: "/r",
    public: true,
    hooks: build(tree),
    responses: { 200: { description: "ok" } },
    acknowledgeNoResponseBodySchema: true,
    handler: (ctx: { state: Record<string, unknown> }) => {
      calls++;
      const marks = Object.keys(ctx.state)
        .filter((key) => /^m\d+$/.test(key))
        .map((key) => Number(key.slice(1)))
        .sort((a, b) => a - b);
      return { status: 200 as const, body: { marks } };
    },
  } as never);
  return { app, calls: () => calls };
}

function request(creds: ReadonlySet<number>, wrong: ReadonlySet<number>): Request {
  const headers: Record<string, string> = { "user-agent": "prop" };
  for (const id of creds) headers[`x-k${id}`] = "ok";
  for (const id of wrong) if (!creds.has(id)) headers[`x-k${id}`] = "nope";
  return new Request("http://localhost/r", { headers });
}

function subset(rand: () => number, p: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < LEAVES; i++) if (rand() < p) out.add(i);
  return out;
}

const SEEDS = 400;

for (const phases of [["pre"], ["before"], ["pre", "before"]] as const) {
  test(`admission and state match the model for ${phases.join("+")} gates`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 7919 + phases.length);
      const tree = genTree(rand, 3, phases);
      const { app } = appFor(tree, false);
      for (let round = 0; round < 6; round++) {
        const creds = subset(rand, 0.5);
        const expected = model(tree, creds);
        const res = await app.fetch(request(creds, subset(rand, 0.3)));
        const where = `seed ${seed} ${show(tree)} creds [${[...creds]}]`;
        if (expected === null) {
          assert.notEqual(res.status, 200, `denied by the model but admitted: ${where}`);
        } else {
          assert.equal(res.status, 200, `allowed by the model but refused: ${where}`);
          const body = (await res.json()) as { marks: number[] };
          assert.deepEqual(
            body.marks,
            [...expected].sort((a, b) => a - b),
            `handler saw state from a branch that did not win: ${where}`,
          );
        }
      }
    }
  });
}

for (const phases of [["pre"], ["pre", "before"]] as const) {
  test(`a stored response is never replayed past ${phases.join("+")} gates`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 104729 + phases.length);
      const tree = genTree(rand, 3, phases);
      if (!rootRunsBeforeReplay(tree)) continue;
      const { app } = appFor(tree, true);
      const all = new Set(Array.from({ length: LEAVES }, (_, i) => i));
      const first = await app.fetch(request(all, new Set()));
      assert.equal(first.status, 200, `seed ${seed} ${show(tree)}: all credentials must pass`);
      for (let round = 0; round < 6; round++) {
        const creds = subset(rand, 0.5);
        if (model(tree, creds) !== null) continue;
        const res = await app.fetch(request(creds, new Set()));
        assert.notEqual(
          res.status,
          200,
          `stored response replayed to a denied request: seed ${seed} ${show(tree)} creds [${[...creds]}]`,
        );
      }
    }
  });
}

/**
 * True when no gate in the tree is a bare `beforeHandle` hook. A hand-written
 * `beforeHandle` guard registered below `responseCache()` runs after the
 * cache answers (documented: use a pre-body gate, or mount the guard above
 * the cache), so only trees made of pre-body gates promise to run ahead of a
 * replay. The mixed-phase generator still exercises nesting; it just skips
 * the trees that contain such a guard.
 */
function rootRunsBeforeReplay(tree: Tree): boolean {
  if (tree.kind === "pre") return true;
  if (tree.kind === "before") return false;
  return tree.children.every(rootRunsBeforeReplay);
}

// ---------------------------------------------------------------------------
// Optional-mode branches, with and without an earlier auth hook
// ---------------------------------------------------------------------------

type OptTree =
  | { kind: "pre"; id: number }
  | { kind: "optional" }
  | { kind: "every"; children: OptTree[] }
  | { kind: "some"; children: OptTree[] };

function genOptTree(rand: () => number, depth: number): OptTree {
  if (depth === 0 || rand() < 0.35) {
    return rand() < 0.3 ? { kind: "optional" } : { kind: "pre", id: Math.floor(rand() * LEAVES) };
  }
  const width = 2 + Math.floor(rand() * 2);
  return {
    kind: rand() < 0.4 ? "every" : "some",
    children: Array.from({ length: width }, () => genOptTree(rand, depth - 1)),
  };
}

function showOpt(tree: OptTree): string {
  if (tree.kind === "pre") return `pre(${tree.id})`;
  if (tree.kind === "optional") return "optional";
  return `${tree.kind}(${tree.children.map(showOpt).join(", ")})`;
}

function buildOpt(tree: OptTree): Hooks {
  if (tree.kind === "every") return every(...tree.children.map(buildOpt));
  if (tree.kind === "some") return some(...tree.children.map(buildOpt));
  if (tree.kind === "optional") {
    // No request in these tests carries a signature, so this always takes
    // the "no credential, pass through" path.
    return httpSignatureAuth({
      optional: true,
      algorithms: ["hmac-sha256"],
      resolveKey: () => undefined,
    } as never);
  }
  return build(tree);
}

/**
 * Model with three outcomes. A pass-through is not authentication: inside
 * `some()` it only stands when no sibling denies and none authenticates.
 */
type Outcome = "ok" | "deny" | "pass";

function modelOpt(tree: OptTree, creds: ReadonlySet<number>): Outcome {
  if (tree.kind === "pre") return creds.has(tree.id) ? "ok" : "deny";
  if (tree.kind === "optional") return "pass";
  const results = tree.children.map((child) => modelOpt(child, creds));
  if (tree.kind === "every") {
    if (results.includes("deny")) return "deny";
    return results.includes("ok") ? "ok" : "pass";
  }
  // some(): branches run in order; the first that authenticates wins.
  for (const result of results) if (result === "ok") return "ok";
  return results.includes("deny") ? "deny" : "pass";
}

for (const outerAuth of [false, true]) {
  test(`optional branches never stand in for a strict one (${outerAuth ? "behind" : "without"} an earlier auth hook)`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 15485863 + (outerAuth ? 1 : 0));
      const tree = genOptTree(rand, 3);
      const app = new App({ logger: false, behindProxy: "none" } as never);
      if (outerAuth) {
        app.use(markAuthHook({ preBody() {} } as never));
      }
      app.route({
        method: "GET",
        path: "/r",
        public: true,
        hooks: buildOpt(tree),
        responses: { 200: { description: "ok" } },
        acknowledgeNoResponseBodySchema: true,
        handler: () => ({ status: 200 as const, body: { ok: true } }),
      } as never);
      for (let round = 0; round < 6; round++) {
        const creds = subset(rand, 0.5);
        const expected = modelOpt(tree, creds);
        const res = await app.fetch(request(creds, new Set()));
        const where = `seed ${seed} ${showOpt(tree)} creds [${[...creds]}]`;
        if (expected === "deny") {
          assert.notEqual(res.status, 200, `denied by the model but admitted: ${where}`);
        } else {
          assert.equal(res.status, 200, `allowed by the model but refused: ${where}`);
        }
      }
    }
  });
}
