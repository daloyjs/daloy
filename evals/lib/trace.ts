/**
 * Parse an agent's CLI output into an {@link AgentTrace}: its final answer
 * and which files, tools, skills, and docs it used. Graders read the trace
 * for "don't act" tasks, and `pnpm eval:analyze` summarises it across runs.
 *
 * Parsing is best effort and never throws: unknown events are skipped, and a
 * CLI whose output exposes nothing yields an empty trace.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { OUTPUT_ELIDED, WORKSPACE_APP_NAME } from "./workspace.ts";
import type { EffortFormat } from "./agents.ts";
import type { AgentTrace, TrialResult } from "./types.ts";

/**
 * Longest shell command kept in a trace. Longer ones keep their head and tail,
 * because chained checks (`... && pnpm test`) sit at the end.
 */
const MAX_COMMAND_CHARS = 600;
/** Most shell commands kept in a trace. */
const MAX_COMMANDS = 200;
/** Longest final answer kept in a trace. */
const MAX_MESSAGE_CHARS = 8_000;
/** Longest combined assistant text kept in a trace (the end is kept). */
const MAX_ASSISTANT_TEXT_CHARS = 20_000;

/** Tool-name prefix of the DaloyJS docs MCP server (`--mcp docs`). */
export const DOCS_MCP_TOOL_PREFIX = "daloyjs-docs-";

/** Claude Code's name prefix for the same server's tools (`mcp__<server>__`). */
export const CLAUDE_DOCS_MCP_TOOL_PREFIX = "mcp__daloyjs-docs__";

/** File names with a source-like extension. */
const FILE_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|md|mdx|ya?ml|env\w*)$/;
/** Bare directory names that count as paths in a command (`grep -r x src`). */
const SOURCE_DIRS = new Set(["src", "tests", "lib", "scripts", "legacy", "app", "routes"]);

/**
 * Normalise a path the agent used to a workspace-relative `/` path. With
 * `dir`, paths under it are cut after it. Other absolute paths are cut after
 * the last `/my-daloy-app/` segment; relative paths are kept.
 *
 * @param path - Path as the agent wrote it.
 * @param dir - Workspace root, when known.
 * @returns The normalised path.
 */
export function workspaceRelative(path: string, dir?: string): string {
  let p = path.trim().replaceAll("\\", "/");
  if (dir && (p === dir || p === `${dir}/`)) return ".";
  if (dir && p.startsWith(`${dir}/`)) p = p.slice(dir.length + 1);
  else if (p.startsWith("/")) {
    // Only an absolute path outside the known root falls back to the
    // workspace folder name; a relative path that contains it is already
    // workspace-relative.
    const marker = `/${WORKSPACE_APP_NAME}/`;
    const at = p.lastIndexOf(marker);
    if (at !== -1) p = p.slice(at + marker.length);
  }
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/**
 * Commands that name a path without reading it (`echo src/a.ts`,
 * `mkdir src/x`). Their arguments are not counted as reads.
 */
const NON_READING = new Set([
  "echo", "printf", "touch", "mkdir", "rm", "rmdir", "cd", "pushd", "popd",
  "export", "unset", "true", "false", ":", "sleep", "chmod", "chown",
]);

function pathTokens(segment: string, dir: string | undefined, out: Set<string>): void {
  for (const raw of segment.split(/[\s;|&()<>,=]+/)) {
    const token = raw.replace(/^['"`]+|['"`:]+$/g, "");
    if (!token || token.startsWith("-") || /[*?$\\{}[\]]|:\/\//.test(token)) continue;
    const isPath =
      FILE_EXT.test(token) ||
      (token.includes("/") && /^[\w@./-]+$/.test(token)) ||
      SOURCE_DIRS.has(token.replace(/\/$/, ""));
    if (!isPath) continue;
    const rel = workspaceRelative(token, dir).replace(/\/$/, "");
    // An absolute path ending at the workspace root is the whole project.
    if (rel && !rel.endsWith(`/${WORKSPACE_APP_NAME}`) && rel !== WORKSPACE_APP_NAME)
      out.add(rel);
  }
}


/**
 * Paths a shell command reads, workspace-relative. The command is split into
 * simple commands (on newlines, `;`, `&&`, `||`, `|`); those whose program is
 * in {@link NON_READING} are skipped, so `echo src/a.ts` does not count as
 * reading `src/a.ts`. Script bodies (a Python heredoc) count. This is an
 * inference from the command text, not proof the read succeeded; `read-files`
 * graders accept it because agents read files through the shell constantly.
 *
 * @param command - The command line.
 * @param dir - Workspace root, when known.
 * @returns Unique paths, in order of appearance.
 */
export function pathsInCommand(command: string, dir?: string): string[] {
  const out = new Set<string>();
  for (const segment of command.split(/\n|;|&&|\|\||\|/)) {
    // Skip leading VAR=value assignments to find the program.
    const words = segment.trim().split(/\s+/).filter(Boolean);
    let w = 0;
    while (w < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[w]!)) w++;
    const program = (words[w] ?? "").replace(/^.*\//, "");
    if (NON_READING.has(program)) continue;
    pathTokens(segment, dir, out);
  }
  return [...out];
}

/** Files named in an `apply_patch` body (`*** Update File: path`). */
function pathsInPatch(patch: string, dir?: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm,
  ))
    out.push(workspaceRelative(m[1]!, dir));
  return out;
}

function jsonObjects(output: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of output.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v: unknown = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v))
        out.push(v as Record<string, unknown>);
    } catch {
      // Agent chatter or a truncated line.
    }
  }
  return out;
}

/**
 * Shorten a command to {@link MAX_COMMAND_CHARS}, keeping its head and tail.
 *
 * @param cmd - The command line.
 * @returns The command, or its first and last parts joined by " … ".
 */
export function clip(cmd: string): string {
  if (cmd.length <= MAX_COMMAND_CHARS) return cmd;
  const half = Math.floor((MAX_COMMAND_CHARS - 3) / 2);
  return `${cmd.slice(0, half)} … ${cmd.slice(-half)}`;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Mutable accumulator behind {@link parseTrace}. */
class TraceBuilder {
  finalMessage: string | undefined;
  readonly read = new Set<string>();
  readonly edited = new Set<string>();
  readonly commands: string[] = [];
  readonly tools: Record<string, number> = {};
  readonly skills = new Set<string>();
  docs = 0;
  /** The format reports tool calls (set by the format parser). */
  toolStream = false;
  /** The session's start was captured (set by the format parser). */
  sawStart = false;
  /** Output was elided in the middle (see `runProcess`). */
  elided = false;

  readonly dir: string | undefined;

  constructor(dir?: string) {
    this.dir = dir;
  }

  tool(name: string): void {
    this.tools[name] = (this.tools[name] ?? 0) + 1;
    if (
      name.startsWith(DOCS_MCP_TOOL_PREFIX) ||
      name.startsWith(CLAUDE_DOCS_MCP_TOOL_PREFIX)
    )
      this.docs++;
  }

  editPath(p: unknown): void {
    if (typeof p === "string" && p.trim())
      this.edited.add(workspaceRelative(p, this.dir));
  }

  readPath(p: unknown): void {
    if (Array.isArray(p)) for (const x of p) this.readPath(x);
    else if (typeof p === "string" && p.trim())
      this.read.add(workspaceRelative(p, this.dir));
  }

  command(cmd: string): void {
    if (this.commands.length < MAX_COMMANDS)
      this.commands.push(clip(cmd));
    for (const p of pathsInCommand(cmd, this.dir)) this.read.add(p);
  }

  readonly messages: string[] = [];

  message(text: string | undefined): void {
    if (text && text.trim()) {
      this.finalMessage = text.trim();
      this.messages.push(this.finalMessage);
    }
  }

  build(): AgentTrace {
    return {
      ...(this.finalMessage
        ? {
            finalMessage: this.finalMessage.slice(0, MAX_MESSAGE_CHARS),
            assistantText: this.messages.join("\n\n").slice(-MAX_ASSISTANT_TEXT_CHARS),
          }
        : {}),
      filesRead: [...this.read],
      filesEdited: [...this.edited],
      shellCommands: this.commands,
      toolCalls: this.tools,
      skills: [...this.skills],
      docsMcpCalls: this.docs,
      observed: {
        messages: this.messages.length > 0,
        tools: this.toolStream,
        complete: this.toolStream && this.sawStart && !this.elided,
      },
    };
  }
}

function copilot(b: TraceBuilder, output: string): void {
  for (const ev of jsonObjects(output)) {
    if (ev.type === "session.start") b.sawStart = true;
    // Any session event means the CLI's event stream was captured.
    if (typeof ev.type === "string" && ev.type.includes(".")) b.toolStream = true;
    const data = ev.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (ev.type === "assistant.message") {
      b.message(str(data.content));
      continue;
    }
    if (ev.type !== "tool.execution_start") continue;
    const name = str(data.toolName) ?? "unknown";
    b.tool(name);
    const args = data.arguments;
    if (name === "apply_patch" && typeof args === "string") {
      for (const p of pathsInPatch(args, b.dir)) b.edited.add(p);
      continue;
    }
    if (!args || typeof args !== "object") continue;
    const a = args as Record<string, unknown>;
    if (name === "view") b.readPath(a.path);
    else if (name === "edit" || name === "create") b.editPath(a.path);
    else if (name === "grep" || name === "rg" || name === "glob")
      b.readPath(a.paths ?? a.path);
    else if (name === "bash" || name === "shell") {
      const c = str(a.command);
      if (c) b.command(c);
    } else if (name === "skill") {
      const s = str(a.skill);
      if (s) b.skills.add(s);
    }
  }
}

/**
 * Claude Code, run with `--output-format stream-json --verbose`: a `system`
 * init event, `assistant` events whose `message.content[]` holds `text` and
 * `tool_use` items, and a final `result`. Plain `--output-format json`
 * output (only the `result`) leaves tools unobserved, so trace graders report
 * unverified instead of a false failure.
 */
function claude(b: TraceBuilder, output: string): void {
  let resultText: string | undefined;
  for (const ev of jsonObjects(output)) {
    if (ev.type === "system") b.sawStart = true;
    if (ev.type === "result" || "total_cost_usd" in ev) {
      resultText = str(ev.result);
      continue;
    }
    if (ev.type !== "assistant") continue;
    b.toolStream = true;
    const message = ev.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const raw of content) {
      const item = raw as Record<string, unknown>;
      if (item.type === "text") b.message(str(item.text));
      if (item.type !== "tool_use") continue;
      const name = str(item.name) ?? "unknown";
      b.tool(name);
      const input = (item.input ?? {}) as Record<string, unknown>;
      if (name === "Read" || name === "LS") b.readPath(input.file_path ?? input.path);
      else if (name === "Grep" || name === "Glob") b.readPath(input.path);
      else if (name === "Edit" || name === "MultiEdit" || name === "Write")
        b.editPath(input.file_path);
      else if (name === "NotebookEdit") b.editPath(input.notebook_path);
      else if (name === "Bash") {
        const c = str(input.command);
        if (c) b.command(c);
      } else if (name === "Skill") {
        const sk = str(input.skill) ?? str(input.name) ?? str(input.command);
        if (sk) b.skills.add(sk);
      }
    }
  }
  // The result repeats the last text message; add it only when it differs.
  if (resultText && resultText.trim() !== b.finalMessage) b.message(resultText);
}

/**
 * Codex `exec --json`. It reports shell commands and file changes; file reads
 * happen through shell commands and are inferred from them. Its stream has no
 * distinct start event, so the first `thread.started` (or any event) counts.
 */
function codex(b: TraceBuilder, output: string): void {
  for (const ev of jsonObjects(output)) {
    if (typeof ev.type === "string") {
      b.toolStream = true;
      if (ev.type === "thread.started" || ev.type === "turn.started") b.sawStart = true;
    }
    if (ev.type !== "item.completed") continue;
    const item = ev.item as Record<string, unknown> | undefined;
    if (!item) continue;
    if (item.type === "agent_message") b.message(str(item.text));
    else if (item.type === "command_execution") {
      b.tool("shell");
      const c = str(item.command);
      if (c) b.command(c);
    } else if (item.type === "file_change") {
      b.tool("edit");
      const changes = item.changes as { path?: unknown }[] | undefined;
      for (const ch of changes ?? []) b.editPath(ch.path);
    }
  }
}

/**
 * Parse an agent CLI's output into a trace.
 *
 * @param format - Which CLI produced the output (same values as effort parsing).
 * @param output - Captured stdout/stderr.
 * @param dir - Workspace root, used to make absolute paths relative.
 * @returns The trace; empty (no final answer, no files) for unknown formats.
 */
export function parseTrace(
  format: EffortFormat,
  output: string,
  dir?: string,
): AgentTrace {
  const b = new TraceBuilder(dir);
  b.elided = output.includes(OUTPUT_ELIDED);
  if (format === "copilot-jsonl") copilot(b, output);
  else if (format === "claude-json") claude(b, output);
  else if (format === "codex-jsonl") codex(b, output);
  return b.build();
}

/**
 * Whether the trace shows the agent looked at `file`: viewed, searched,
 * edited, or named in a shell command. A search scoped to a parent directory
 * (`src`) counts; a search of the whole workspace (`.`) does not.
 *
 * @param trace - The trial's trace.
 * @param file - Workspace-relative file path.
 * @returns `true` when the file was looked at.
 */
export function traceTouched(trace: AgentTrace, file: string): boolean {
  const covers = (p: string): boolean =>
    p === file ||
    (p !== "." && p !== "" && file.startsWith(`${p.replace(/\/$/, "")}/`));
  return trace.filesRead.some(covers) || trace.filesEdited.includes(file);
}

/**
 * A recording trace for offline (calibration) adapters: reads through the
 * handle count as files read, and `reply()` sets the final answer.
 */
export class RecordedTrace {
  private readonly b = new TraceBuilder();

  constructor() {
    // Offline solutions record every read through the handle.
    this.b.toolStream = true;
    this.b.sawStart = true;
  }

  /** Record a file read. */
  read(rel: string): void {
    this.b.readPath(rel);
  }

  /** Record a file write. */
  write(rel: string): void {
    this.b.edited.add(workspaceRelative(rel));
  }

  /** Set the final answer. */
  reply(message: string): void {
    this.b.message(message);
  }

  /** The trace recorded so far. */
  build(): AgentTrace {
    return this.b.build();
  }
}

/**
 * Which trace format an agent adapter writes.
 *
 * @param agent - Adapter name from the run metadata.
 * @returns The format, or `none` for adapters without a parseable stream.
 */
export function traceFormatFor(agent: string): EffortFormat {
  if (agent === "copilot") return "copilot-jsonl";
  if (agent === "claude") return "claude-json";
  if (agent === "codex") return "codex-jsonl";
  return "none";
}

/**
 * Re-parse a stored trial's trace from its saved agent output
 * (`<run>-traces/<task>__<ablation>__<trial>.log` next to the results file;
 * a `.regraded` copy reuses the original run's directory), so parser fixes
 * apply to old runs. Falls back to the trace stored in the results JSON.
 * Paths are made relative to the trial's `traceRoot` (or `/work` for a
 * `docker`-sandbox run recorded before it was stored).
 *
 * @param resultsPath - Path of the results JSON.
 * @param agent - Adapter name from the run metadata.
 * @param trial - The stored trial.
 * @returns The freshest trace available, or `undefined`.
 */
export async function loadTrialTrace(
  resultsPath: string,
  agent: string,
  trial: TrialResult,
  sandbox?: string,
): Promise<AgentTrace | undefined> {
  // Re-parse with the root the agent saw, or file reads under it would not
  // match the workspace-relative paths graders check. Runs recorded before
  // traceRoot existed fall back to the sandbox's mount point.
  const root =
    trial.agentRun.traceRoot ?? (sandbox === "docker" ? "/work" : undefined);
  const format = traceFormatFor(agent);
  if (format !== "none") {
    const name = basename(resultsPath).replace(/\.json$/, "");
    const file = `${trial.taskId}__${trial.ablation}__${trial.trial}.log`;
    for (const d of [`${name}-traces`, `${name.replace(/\.regraded$/, "")}-traces`]) {
      try {
        return parseTrace(
          format,
          await readFile(join(dirname(resultsPath), d, file), "utf8"),
          root,
        );
      } catch {
        // Not in this directory.
      }
    }
  }
  return trial.agentRun.trace;
}
