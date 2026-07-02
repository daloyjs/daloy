/**
 * `defineConfig({ schema, source })` — boot-time typed configuration
 * validation.
 *
 * Single boot-time helper that loads application configuration from a
 * caller-chosen source (`process.env`, a file on disk, or an async secrets
 * resolver), validates the merged object against a Standard-Schema
 * validator, and aggregates **every** validation issue into a single
 * structured error printed to stderr before the process exits.
 *
 * The point is to fail fast and loud: a misconfigured deployment should
 * surface every missing/invalid key in one shot so operators do not have
 * to redeploy four times to discover four different typos.
 *
 * @since 0.20.0
 */

import { validate, type StandardSchemaV1 } from "./schema.js";

/**
 * Aggregated validation failure thrown by {@link defineConfig}. Holds the
 * full list of `{ key, message }` issues so callers can surface them in a
 * dashboard, a startup probe, or a custom error renderer.
 */
export class ConfigValidationError extends Error {
  /** Every validation issue, as `{ key, message }` pairs (`key` is the dotted path, `"<root>"`/`"<source>"` for top-level failures). */
  readonly issues: ReadonlyArray<{ key: string; message: string }>;
  constructor(issues: ReadonlyArray<{ key: string; message: string }>) {
    const summary = issues
      .map((i) => `  - ${i.key || "<root>"}: ${i.message}`)
      .join("\n");
    super(
      `defineConfig(): configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"})\n${summary}`,
    );
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

/**
 * Source the raw object that gets handed to the schema validator. The
 * built-in sources are intentionally narrow — anything more elaborate
 * (Vault, Doppler, AWS Secrets Manager, ...) should arrive via the
 * `"custom"` source with an async resolver.
 */
export type ConfigSource =
  | "env"
  | { kind: "env"; env: Record<string, string | undefined> }
  | { kind: "file"; path: string; parse?: (text: string) => unknown }
  | { kind: "object"; data: Record<string, unknown> }
  | { kind: "custom"; resolve: () => Promise<Record<string, unknown>> };

/** Options accepted by {@link defineConfig}. */
export interface DefineConfigOptions<S extends StandardSchemaV1> {
  /** Standard-Schema validator (Zod, Valibot, ArkType, TypeBox, ...). */
  schema: S;
  /** Source of the raw input. Default `"env"` (reads from `process.env`). */
  source?: ConfigSource;
  /**
   * Optional pre-validation transform. Useful for coercing string env
   * values (`"true"` / `"42"`) to typed primitives before they hit the
   * schema, or for renaming `FOO_BAR` → `fooBar`. Receives the raw
   * source object and must return the object handed to the validator.
   */
  transform?: (raw: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Stream errors are written to. Defaults to `process.stderr`. Set to
   * `false` to suppress the printed summary; the thrown
   * {@link ConfigValidationError} still carries `issues`.
   */
  stderr?: { write: (chunk: string) => void } | false;
}

async function readSource(source: ConfigSource): Promise<Record<string, unknown>> {
  if (source === "env") {
    return readEnvObject(
      (typeof process !== "undefined" ? process.env : {}) as Record<
        string,
        string | undefined
      >,
    );
  }
  if (source.kind === "env") return readEnvObject(source.env);
  if (source.kind === "object") return { ...source.data };
  if (source.kind === "file") {
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(source.path, "utf8");
    const parsed = (source.parse ?? JSON.parse)(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigValidationError([
        { key: source.path, message: "file did not parse to an object" },
      ]);
    }
    return { ...(parsed as Record<string, unknown>) };
  }
  return { ...(await source.resolve()) };
}

function readEnvObject(env: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function pathToKey(path: ReadonlyArray<PropertyKey | { key: PropertyKey }>): string {
  return path
    .map((segment) => {
      if (typeof segment === "object" && segment !== null && "key" in segment) {
        return String(segment.key);
      }
      return String(segment);
    })
    .join(".");
}

/**
 * Load and validate configuration at boot. Aggregates every Standard-Schema
 * issue into a single {@link ConfigValidationError}, prints a human-readable
 * summary to stderr, and only resolves with the typed config object when
 * validation succeeded.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { defineConfig } from "@daloyjs/core";
 *
 * const Config = z.object({
 *   PORT: z.coerce.number().int().min(1).max(65535),
 *   DATABASE_URL: z.string().url(),
 *   NODE_ENV: z.enum(["development", "production", "test"]),
 * });
 *
 * export const config = await defineConfig({ schema: Config });
 * ```
 *
 * @param opts - Schema, source (default `"env"`), optional `transform`, and the stderr sink.
 * @returns The validated, typed configuration object.
 * @throws {ConfigValidationError} When the source cannot be read or the schema reports issues.
 * @since 0.20.0
 */
export async function defineConfig<S extends StandardSchemaV1>(
  opts: DefineConfigOptions<S>,
): Promise<StandardSchemaV1.InferOutput<S>> {
  const stderr =
    opts.stderr === false
      ? null
      : (opts.stderr ?? (typeof process !== "undefined" ? process.stderr : null));
  let raw: Record<string, unknown>;
  try {
    raw = await readSource(opts.source ?? "env");
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      if (stderr) stderr.write(`${err.message}\n`);
      throw err;
    }
    const wrapped = new ConfigValidationError([
      {
        key: "<source>",
        message: err instanceof Error ? err.message : "failed to read source",
      },
    ]);
    if (stderr) stderr.write(`${wrapped.message}\n`);
    throw wrapped;
  }
  const input = opts.transform ? opts.transform(raw) : raw;
  const result = await validate(opts.schema, input);
  if (result.issues) {
    const issues = result.issues.map((issue) => ({
      key: pathToKey(issue.path ?? []),
      message: issue.message,
    }));
    const err = new ConfigValidationError(issues);
    if (stderr) stderr.write(`${err.message}\n`);
    throw err;
  }
  return result.value;
}
