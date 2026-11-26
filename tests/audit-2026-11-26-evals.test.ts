/**
 * Regression tests for the two medium findings of the 2026-11-26 audit of the
 * agent-eval harness:
 *
 * 1. `eval:regrade` wrote through a symlink the agent left at a path the
 *    harness writes (the process guard, a protected test file), overwriting a
 *    host file outside the workspace.
 * 2. Agent output and the stored diff were kept unredacted, so a credential
 *    the agent printed ended up in the trace file, the results JSON, and the
 *    uploaded CI artifact.
 */

import { randomUUID } from "node:crypto";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { forwardedCredentials, redactSecrets, resolveAgent } from "../evals/lib/agents.ts";
import { copyWorkspace, workspaceHandle } from "../evals/lib/workspace.ts";
import type { EvalTask } from "../evals/lib/types.ts";

/** A dummy credential built at run time, so no secret-shaped literal is committed. */
const dummyCredential = (): string => `dummy-${randomUUID()}-${randomUUID()}`;

describe("eval harness writes never follow a symlink the agent left", () => {
  test("write() replaces a link at the target instead of writing through it", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-audit-write-"));
    try {
      const dir = join(root, "ws");
      const victim = join(root, "host-file.txt");
      await mkdir(join(dir, "tests", "__eval_hidden__"), { recursive: true });
      await writeFile(victim, "HOST FILE\n");
      const target = join(dir, "tests", "__eval_hidden__", "process-guard.mjs");
      await symlink(victim, target);

      await workspaceHandle(dir).write("tests/__eval_hidden__/process-guard.mjs", "GUARD\n");

      assert.equal(await readFile(victim, "utf8"), "HOST FILE\n", "the host file is untouched");
      assert.equal((await lstat(target)).isSymbolicLink(), false, "the link was replaced");
      assert.equal(await readFile(target, "utf8"), "GUARD\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("write() does not create a host file through a dangling link", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-audit-dangling-"));
    try {
      const dir = join(root, "ws");
      const missing = join(root, "did-not-exist.txt");
      await mkdir(join(dir, "tests"), { recursive: true });
      await symlink(missing, join(dir, "tests", "keep.test.ts"));

      await workspaceHandle(dir).write("tests/keep.test.ts", "BASELINE\n");

      await assert.rejects(lstat(missing), "nothing was created outside the workspace");
      assert.equal(await readFile(join(dir, "tests", "keep.test.ts"), "utf8"), "BASELINE\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("write() refuses a target that is a directory, and still writes plain files", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-audit-plain-"));
    try {
      const dir = join(root, "ws");
      await mkdir(join(dir, "tests", "blocked.mjs"), { recursive: true });
      const ws = workspaceHandle(dir);

      await assert.rejects(ws.write("tests/blocked.mjs", "x"), /not a regular file/);

      // Happy path: create, then overwrite (truncating the longer content).
      await ws.write("src/new/file.ts", "first version\n");
      await ws.write("src/new/file.ts", "second\n");
      assert.equal(await ws.read("src/new/file.ts"), "second\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("remove() refuses a path whose parent is a link out of the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-audit-remove-"));
    try {
      const dir = join(root, "ws");
      const outside = join(root, "outside");
      await mkdir(dir, { recursive: true });
      await mkdir(join(outside, "__eval_hidden__"), { recursive: true });
      await writeFile(join(outside, "__eval_hidden__", "keep.txt"), "KEEP\n");
      await symlink(outside, join(dir, "tests"));
      const ws = workspaceHandle(dir);

      await assert.rejects(ws.remove("tests/__eval_hidden__"), /outside the workspace/);
      assert.equal(await readFile(join(outside, "__eval_hidden__", "keep.txt"), "utf8"), "KEEP\n");

      // Happy path: a normal removal inside the workspace still works.
      await ws.write("tmp/a.txt", "a");
      await ws.remove("tmp");
      assert.equal(await ws.exists("tmp/a.txt"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the copy regrade now grades holds none of the links a replayed diff re-creates", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-audit-regrade-"));
    try {
      const dir = join(root, "ws");
      const victim = join(root, "host-file.txt");
      await mkdir(join(dir, "tests", "__eval_hidden__"), { recursive: true });
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "app.ts"), "export const ok = true;\n");
      await writeFile(victim, "HOST FILE\n");
      // What `git apply` leaves behind for a stored `new file mode 120000` entry.
      await symlink(victim, join(dir, "tests", "__eval_hidden__", "process-guard.mjs"));
      await symlink(victim, join(dir, "tests", "keep.test.ts"));

      const graded = join(root, "graded");
      await copyWorkspace(dir, graded);
      const ws = workspaceHandle(graded);
      await ws.write("tests/__eval_hidden__/process-guard.mjs", "GUARD\n");
      await ws.write("tests/keep.test.ts", "BASELINE\n");

      assert.equal(await readFile(victim, "utf8"), "HOST FILE\n", "the host file is untouched");
      assert.equal(await ws.read("src/app.ts"), "export const ok = true;\n", "regular files are copied");
      assert.equal(await ws.read("tests/keep.test.ts"), "BASELINE\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("credentials are redacted from stored agent output", () => {
  test("redactSecrets replaces the value and its common encodings, and names the variable", () => {
    const value = dummyCredential();
    const bytes = Buffer.from(value, "utf8");
    const output = [
      `plain ${value}`,
      `b64 ${bytes.toString("base64")}`,
      `b64url ${bytes.toString("base64url")}`,
      `hex ${bytes.toString("hex")}`,
      `HEX ${bytes.toString("hex").toUpperCase()}`,
      "unrelated line",
    ].join("\n");

    const { text, leaked } = redactSecrets(output, { MODEL_API_KEY: value });

    assert.deepEqual(leaked, ["MODEL_API_KEY"]);
    assert.equal(text.includes(value), false);
    assert.equal(text.includes(bytes.toString("base64url")), false);
    assert.equal(text.toLowerCase().includes(bytes.toString("hex")), false);
    assert.equal(text.split("[REDACTED:MODEL_API_KEY]").length - 1, 5);
    assert.match(text, /unrelated line/);
  });

  test("redactSecrets catches a URL-encoded value", () => {
    const value = `${dummyCredential()}/+=&`;
    const { text, leaked } = redactSecrets(`q=${encodeURIComponent(value)}`, { A_TOKEN: value });
    assert.deepEqual(leaked, ["A_TOKEN"]);
    assert.equal(text, "q=[REDACTED:A_TOKEN]");
  });

  test("redactSecrets leaves clean output alone and ignores short or unset values", () => {
    const output = "the agent said abc and 1234567, nothing else";
    const { text, leaked } = redactSecrets(output, {
      SHORT_KEY: "abc",
      SEVEN_KEY: "1234567",
      UNSET_KEY: undefined,
      REAL_KEY: dummyCredential(),
    });
    assert.equal(text, output);
    assert.deepEqual(leaked, []);
  });

  test("forwardedCredentials picks credential variables only, never paths", () => {
    const names = ["AUDIT_DUMMY_API_KEY", "AUDIT_DUMMY_OAUTH_TOKEN", "AUDIT_DUMMY_HOME", "AUDIT_DUMMY_UNSET_KEY"];
    const value = dummyCredential();
    process.env.AUDIT_DUMMY_API_KEY = value;
    process.env.AUDIT_DUMMY_OAUTH_TOKEN = `${value}-second`;
    process.env.AUDIT_DUMMY_HOME = "/a/long/enough/home/path";
    try {
      assert.deepEqual(forwardedCredentials(names), {
        AUDIT_DUMMY_API_KEY: value,
        AUDIT_DUMMY_OAUTH_TOKEN: `${value}-second`,
      });
    } finally {
      for (const n of names) delete process.env[n];
    }
  });

  test(
    "a live adapter stores no credential the agent printed, and reports the leak",
    { skip: process.platform === "win32" },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "eval-audit-redact-"));
      const before = { path: process.env.PATH, key: process.env.ANTHROPIC_API_KEY };
      const value = dummyCredential();
      try {
        // A stand-in `claude` CLI whose "agent" ran `env`: it prints the key
        // it was handed, as a real CLI's shell tool would.
        const bin = join(root, "bin");
        const ws = join(root, "ws");
        await mkdir(bin, { recursive: true });
        await mkdir(ws, { recursive: true });
        await writeFile(
          join(bin, "claude"),
          '#!/bin/sh\necho "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"\necho "done"\n',
        );
        await chmod(join(bin, "claude"), 0o755);
        process.env.PATH = `${bin}${delimiter}${before.path ?? ""}`;
        process.env.ANTHROPIC_API_KEY = value;

        const agent = resolveAgent("claude");
        assert.ok(agent.credentialVars?.includes("ANTHROPIC_API_KEY"));
        assert.equal(agent.credentialVars?.includes("XDG_CONFIG_HOME"), false);
        const run = await agent.run({
          task: { id: "audit-dummy" } as unknown as EvalTask,
          dir: ws,
          prompt: "dummy prompt",
          timeoutMs: 20_000,
        });

        assert.equal(JSON.stringify(run).includes(value), false, "no stored field holds the credential");
        assert.match(run.transcript ?? "", /ANTHROPIC_API_KEY=\[REDACTED:ANTHROPIC_API_KEY\]/);
        assert.deepEqual(run.secretLeak, ["ANTHROPIC_API_KEY"]);

        // Happy path: an agent that prints nothing sensitive is not flagged.
        await writeFile(join(bin, "claude"), '#!/bin/sh\necho "all good"\n');
        const clean = await agent.run({
          task: { id: "audit-dummy" } as unknown as EvalTask,
          dir: ws,
          prompt: "dummy prompt",
          timeoutMs: 20_000,
        });
        assert.equal(clean.secretLeak, undefined);
        assert.match(clean.transcript ?? "", /all good/);
      } finally {
        if (before.path === undefined) delete process.env.PATH;
        else process.env.PATH = before.path;
        if (before.key === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = before.key;
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
