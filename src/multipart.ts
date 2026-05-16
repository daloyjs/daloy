/**
 * Multipart/form-data ergonomics.
 *
 * The platform's `Request#formData()` already parses `multipart/form-data`
 * into a `FormData` instance with `File` entries. DaloyJS turns that parsed
 * map into a plain `Record<string, unknown>` before validation runs (see
 * `src/app.ts#readBody`). This module adds the missing pieces:
 *
 * 1. **`fileField(options)`** — a Standard-Schema validator for a single
 *    uploaded file (a `File` or `Blob`). Enforces `maxBytes`, the `accept`
 *    MIME allowlist, and an optional filename matcher. Returns the file
 *    untouched on success — DaloyJS does not buffer it for you, so handlers
 *    can stream it directly to S3, disk, etc.
 * 2. **`multipartObject(shape, options)`** — a Standard-Schema validator
 *    that wraps a record of field validators. The returned schema carries a
 *    private marker so the OpenAPI generator emits `multipart/form-data`
 *    (with `binary` files) instead of `application/json`.
 *
 * Together with the existing body-size cap, content-type allowlist, and the
 * new `AppOptions.multipart` per-file/field/total caps in `app.ts`, this is
 * the supported way to model file uploads contract-first.
 *
 * ```ts
 * import { z } from "zod";
 * import { App, fileField, multipartObject } from "@daloyjs/core";
 *
 * app.route({
 *   method: "POST",
 *   path: "/avatars",
 *   operationId: "uploadAvatar",
 *   request: {
 *     body: multipartObject({
 *       title: z.string().min(1),
 *       file: fileField({
 *         maxBytes: 1_000_000,
 *         accept: ["image/png", "image/jpeg"],
 *       }),
 *     }),
 *   },
 *   responses: { 201: { description: "Created" } },
 *   handler: async ({ body }) => {
 *     // body.file is a File you can pipe somewhere.
 *     await uploadToS3(body.file.stream(), body.file.type);
 *     return { status: 201, body: { ok: true } };
 *   },
 * });
 * ```
 */

import type { StandardSchemaV1 } from "./schema.js";
import { validate } from "./schema.js";

/** Marker key used by the OpenAPI generator to emit `multipart/form-data`. */
export const MULTIPART_SCHEMA_MARKER = "~daloy.multipart" as const;
/** Marker key for individual file fields. */
export const FILE_FIELD_MARKER = "~daloy.file" as const;

/** Options for {@link fileField}. */
export interface FileFieldOptions {
  /** Reject the file if its `size` exceeds this many bytes. */
  maxBytes?: number;
  /**
   * MIME allowlist. Each entry is matched against the file's `type` either
   * exactly (e.g. `"image/png"`) or as a wildcard (`"image/*"`). When
   * omitted, any MIME type is accepted.
   */
  accept?: string[];
  /**
   * Optional filename matcher. Receives the file's `name` and must return
   * truthy for the file to be accepted. Useful for forcing extensions.
   */
  filename?: (name: string) => boolean;
  /** When true, accept `null`/`undefined` values. Default: false. */
  optional?: boolean;
  /** OpenAPI hint for documentation purposes. Default: `"binary"`. */
  format?: "binary" | "byte";
}

/** A `Blob`-shaped value plus an optional `name` (matches `File`). */
export type UploadedFile = Blob & { readonly name?: string };

export interface FileFieldSchema<Output = UploadedFile>
  extends StandardSchemaV1<unknown, Output> {
  readonly [FILE_FIELD_MARKER]: Required<Pick<FileFieldOptions, "format">> &
    FileFieldOptions;
}

function isBlobLike(v: unknown): v is Blob {
  if (v == null || typeof v !== "object") return false;
  const b = v as { size?: unknown; type?: unknown; arrayBuffer?: unknown };
  return (
    typeof b.size === "number" &&
    typeof b.type === "string" &&
    typeof b.arrayBuffer === "function"
  );
}

function mimeMatches(actual: string, pattern: string): boolean {
  const a = actual.toLowerCase();
  const p = pattern.toLowerCase();
  if (p === "*/*") return true;
  if (p.endsWith("/*")) {
    const prefix = p.slice(0, -1); // keep trailing "/"
    return a.startsWith(prefix);
  }
  return a === p;
}

/**
 * Validator for a single uploaded `File`/`Blob` field.
 *
 * Use inside a `multipartObject({...})` body schema, or directly inside any
 * Standard-Schema-compatible object schema (Zod, Valibot, ...). DaloyJS
 * keeps the underlying `File` reference so handlers can stream the body.
 */
export function fileField(
  options: FileFieldOptions & { optional: true }
): FileFieldSchema<UploadedFile | null | undefined>;
export function fileField(options?: FileFieldOptions): FileFieldSchema<UploadedFile>;
export function fileField(
  options: FileFieldOptions = {}
): FileFieldSchema<UploadedFile | null | undefined> {
  const opts: Required<Pick<FileFieldOptions, "format">> & FileFieldOptions = {
    format: options.format ?? "binary",
    ...options,
  };

  const schema: FileFieldSchema<UploadedFile | null | undefined> = {
    "~standard": {
      version: 1,
      vendor: "daloyjs",
      validate(value): StandardSchemaV1.Result<UploadedFile | null | undefined> {
        if (value === undefined || value === null) {
          if (opts.optional) {
            return { value };
          }
          return { issues: [{ message: "Expected a file upload" }] };
        }
        if (!isBlobLike(value)) {
          return { issues: [{ message: "Expected a file upload" }] };
        }
        const file = value as UploadedFile;
        if (opts.maxBytes !== undefined && file.size > opts.maxBytes) {
          return {
            issues: [
              {
                message: `File exceeds maxBytes (${file.size} > ${opts.maxBytes})`,
              },
            ],
          };
        }
        if (opts.accept && opts.accept.length > 0) {
          const ok = opts.accept.some((p) => mimeMatches(file.type || "", p));
          if (!ok) {
            return {
              issues: [
                {
                  message: `File type "${
                    file.type || "(unknown)"
                  }" not in accept list: ${opts.accept.join(", ")}`,
                },
              ],
            };
          }
        }
        if (opts.filename) {
          const name = typeof file.name === "string" ? file.name : "";
          if (!opts.filename(name)) {
            return {
              issues: [{ message: `File name "${name}" rejected by filename matcher` }],
            };
          }
        }
        return { value: file };
      },
    },
    [FILE_FIELD_MARKER]: opts,
  };
  return schema;
}

/** Type-only check used by the OpenAPI generator. */
export function isFileFieldSchema(
  s: unknown
): s is FileFieldSchema {
  return !!s && typeof s === "object" && FILE_FIELD_MARKER in (s as object);
}

/** Options for {@link multipartObject}. */
export interface MultipartObjectOptions {
  /**
   * Reject extra fields not declared in the shape. Default: false (extras
   * are passed through to handlers, but never validated).
   */
  strict?: boolean;
}

export type MultipartShape = Record<string, StandardSchemaV1>;

type MultipartOutput<S extends MultipartShape> = {
  [K in keyof S]: StandardSchemaV1.InferOutput<S[K]>;
};

interface MultipartSchema<S extends MultipartShape>
  extends StandardSchemaV1<Record<string, unknown>, MultipartOutput<S>> {
  readonly [MULTIPART_SCHEMA_MARKER]: { shape: S; strict: boolean };
}

/**
 * Build a Standard-Schema validator for a `multipart/form-data` request
 * body. Each entry in `shape` validates one form field by name. File fields
 * should use {@link fileField}; non-file fields can use any Standard-Schema
 * validator (`z.string()`, `v.number()`, ...).
 */
export function multipartObject<S extends MultipartShape>(
  shape: S,
  options: MultipartObjectOptions = {}
): MultipartSchema<S> {
  const strict = options.strict ?? false;
  const schema: MultipartSchema<S> = {
    "~standard": {
      version: 1,
      vendor: "daloyjs",
      async validate(
        value
      ): Promise<StandardSchemaV1.Result<MultipartOutput<S>>> {
        if (value === null || typeof value !== "object") {
          return { issues: [{ message: "Expected a multipart form body" }] };
        }
        const input = value as Record<string, unknown>;
        const issues: StandardSchemaV1.Issue[] = [];
        const out: Record<string, unknown> = {};
        for (const [key, fieldSchema] of Object.entries(shape)) {
          const r = await validate(fieldSchema, input[key]);
          if (r.issues) {
            for (const i of r.issues) {
              issues.push({
                message: i.message,
                path: [key, ...(i.path ?? [])],
              });
            }
          } else {
            out[key] = r.value;
          }
        }
        if (strict) {
          for (const key of Object.keys(input)) {
            if (!(key in shape)) {
              issues.push({
                message: `Unknown field "${key}"`,
                path: [key],
              });
            }
          }
        }
        if (issues.length > 0) return { issues };
        return { value: out as MultipartOutput<S> };
      },
    },
    [MULTIPART_SCHEMA_MARKER]: { shape, strict },
  };
  return schema;
}

/** Type-only check used by the OpenAPI generator and request-body parser. */
export function isMultipartObjectSchema(
  s: unknown
): s is MultipartSchema<MultipartShape> {
  return !!s && typeof s === "object" && MULTIPART_SCHEMA_MARKER in (s as object);
}

/** Internal: pull the multipart shape so the OpenAPI generator can walk it. */
export function getMultipartShape(
  s: unknown
): { shape: MultipartShape; strict: boolean } | undefined {
  if (!isMultipartObjectSchema(s)) return undefined;
  return (s as unknown as { [MULTIPART_SCHEMA_MARKER]: { shape: MultipartShape; strict: boolean } })[
    MULTIPART_SCHEMA_MARKER
  ];
}

/** Internal: read the file-field options used for OpenAPI documentation. */
export function getFileFieldOptions(
  s: unknown
): (Required<Pick<FileFieldOptions, "format">> & FileFieldOptions) | undefined {
  if (!isFileFieldSchema(s)) return undefined;
  return (s as unknown as { [FILE_FIELD_MARKER]: Required<Pick<FileFieldOptions, "format">> & FileFieldOptions })[
    FILE_FIELD_MARKER
  ];
}
