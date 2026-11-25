/** Replay the books pilot through an isolated DeepEval reporter. */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AGENT_IMAGE } from "./lib/docker-sandbox.ts";
import { graderId, trialOutcome } from "./lib/types.ts";
import { task } from "./tasks/scaffold-books-list/task.ts";

const label = z.string().regex(/^[a-zA-Z0-9._/-]+$/);
const schema = z.object({
  meta: z.object({ agent: label, model: label.optional() }),
  trials: z
    .array(
      z.object({
        taskId: z.literal(task.id),
        graderRevision: z.number().int().positive().default(1),
        ablation: label,
        trial: z.number().int().positive(),
        pass: z.boolean(),
        unverified: z.literal(true).optional(),
        unverifiedReason: z.string().optional(),
        agentRun: z.object({
          durationMs: z.number().nonnegative(),
          timedOut: z.boolean(),
        }),
        grades: z.array(
          z.object({
            id: label,
            pass: z.boolean(),
            unverified: z.literal(true).optional(),
            details: z.array(z.string()),
            durationMs: z.number().nonnegative().default(0),
          }),
        ),
      }),
    )
    .min(1),
});

// The native Markdown exporter interpolates reasons. Keep log snippets plain text.
function plain(value: string): string {
  return value
    .slice(0, 400)
    .replace(/[^a-zA-Z0-9 ,.:/=-]/gu, (char) => `&#${char.codePointAt(0)};`);
}

const paths = process.argv.slice(2);
if (!paths.length)
  throw new Error("Usage: pnpm --silent eval:pilot <books-run.json> [...]");
const ids = task.graders.map(graderId);
const rows = [];
let revision: number | undefined;
for (const [index, path] of paths.entries()) {
  const run = schema.parse(JSON.parse(await readFile(path, "utf8")));
  for (const t of run.trials) {
    revision ??= t.graderRevision;
    if (revision !== t.graderRevision)
      throw new Error("Report each grader revision separately");
    const name = `Run ${index + 1} / ${run.meta.model ?? run.meta.agent} / ${t.taskId} / ${t.ablation} / trial ${t.trial}`;
    if (
      t.grades.length &&
      (t.grades.length !== ids.length ||
        ids.some((id) => t.grades.filter((g) => g.id === id).length !== 1))
    ) {
      throw new Error(`Incomplete or duplicate grade set: ${name}`);
    }
    if (t.grades.some((g) => g.pass && g.unverified))
      throw new Error("Invalid unverified pass");
    const outcome = t.grades.length
      ? trialOutcome(t.grades, t.agentRun)
      : { pass: false, unverified: true };
    if (
      outcome.pass !== t.pass ||
      Boolean(outcome.unverified) !== Boolean(t.unverified)
    ) {
      throw new Error(`Recorded verdict disagrees with evidence: ${name}`);
    }
    rows.push({
      name,
      pass: t.pass,
      unverified: !!t.unverified,
      timedOut: t.agentRun.timedOut,
      durationMs: t.agentRun.durationMs,
      reason: plain(t.unverifiedReason ?? ""),
      grades: t.grades.map((g) => ({
        id: g.id,
        pass: g.pass,
        unverified: !!g.unverified,
        reason: plain(g.details[0] ?? ""),
      })),
    });
  }
}
const pilot = fileURLToPath(new URL("./pilot/", import.meta.url));
const child = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--read-only",
    "--user",
    "node",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--tmpfs",
    "/tmp",
    "-e",
    "HOME=/tmp",
    "-e",
    "DEEPEVAL_TELEMETRY_OPT_OUT=1",
    "-w",
    "/tmp",
    "-v",
    `${pilot}render.mjs:/reporter/render.mjs:ro`,
    "-v",
    `${pilot}node_modules:/reporter/node_modules:ro`,
    "--entrypoint",
    "node",
    AGENT_IMAGE,
    "/reporter/render.mjs",
  ],
  {
    input: JSON.stringify({ ids, rows, revision }),
    stdio: ["pipe", "inherit", "inherit"],
  },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
