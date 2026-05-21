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

/** Magic-bytes signature spec for {@link FileFieldOptions.magicBytes}. */
export interface FileMagicBytesSignature {
  /** Byte sequence that must appear in the file. */
  bytes: readonly number[] | Uint8Array;
  /** Offset where `bytes` must start. Default: `0`. */
  offset?: number;
  /** Declared MIME type(s) this signature is valid for. */
  mime?: string | readonly string[];
  /** Human-readable label used in validation errors and OpenAPI hints. */
  label?: string;
}

/**
 * Magic-bytes verification config. Pass `true` to use the bundled
 * signatures derived from `accept`, or supply your own signature(s).
 */
export type FileMagicBytesOption =
  | true
  | FileMagicBytesSignature
  | readonly FileMagicBytesSignature[];

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
  /**
   * Verify file signatures before the handler receives the upload. `true`
   * derives known signatures from `accept` (PNG/JPEG/GIF/WebP/PDF/ZIP/GZIP).
   * Custom signatures can be supplied for domain-specific formats.
   */
  magicBytes?: FileMagicBytesOption;
  /**
   * Reject scriptable / vector image formats that downstream tooling like
   * ImageMagick can execute (SVG, MVG, MSL, PostScript / EPS). These
   * formats are a classic vector for ImageTragick-style RCE
   * (https://imagetragick.com) and SSRF/XXE against XML parsers, so they
   * are blocked by default whenever `magicBytes` is enabled. Set to
   * `false` to opt back in — you are then responsible for sandboxing the
   * renderer (see SECURITY.md). Set to `true` explicitly to enable the
   * check even without `magicBytes`.
   */
  rejectScriptableImages?: boolean;
  /** When true, accept `null`/`undefined` values. Default: false. */
  optional?: boolean;
  /** OpenAPI hint for documentation purposes. Default: `"binary"`. */
  format?: "binary" | "byte";
}

/** A `Blob`-shaped value plus an optional `name` (matches `File`). */
export type UploadedFile = Blob & { readonly name?: string };

/**
 * Standard-Schema validator returned by {@link fileField}. Carries a
 * `[FILE_FIELD_MARKER]` so OpenAPI generation can detect file fields and
 * emit `format: binary`/`byte` accordingly.
 */
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

interface InternalMagicSignature {
  label: string;
  mimes: readonly string[];
  readLength: number;
  match(bytes: Uint8Array): boolean;
}

const KNOWN_MAGIC_SIGNATURES: readonly InternalMagicSignature[] = [
  fixedMagic("png", ["image/png"], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  {
    label: "jpeg",
    mimes: ["image/jpeg"],
    readLength: 3,
    match: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    label: "gif",
    mimes: ["image/gif"],
    readLength: 6,
    match: (bytes) =>
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38 &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) &&
      bytes[5] === 0x61,
  },
  {
    label: "webp",
    mimes: ["image/webp"],
    readLength: 12,
    match: (bytes) =>
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50,
  },
  fixedMagic("pdf", ["application/pdf"], [0x25, 0x50, 0x44, 0x46, 0x2d]),
  {
    label: "zip",
    mimes: ["application/zip", "application/x-zip-compressed"],
    readLength: 4,
    match: (bytes) =>
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
        (bytes[2] === 0x05 && bytes[3] === 0x06) ||
        (bytes[2] === 0x07 && bytes[3] === 0x08)),
  },
  fixedMagic("gzip", ["application/gzip", "application/x-gzip"], [0x1f, 0x8b]),
] as const;

function fixedMagic(
  label: string,
  mimes: readonly string[],
  expected: readonly number[],
): InternalMagicSignature {
  return {
    label,
    mimes,
    readLength: expected.length,
    match: (bytes) => expected.every((byte, index) => bytes[index] === byte),
  };
}

function normalizeCustomMagicSignature(
  value: FileMagicBytesSignature,
): InternalMagicSignature {
  const offset = value.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("fileField(): magicBytes.offset must be a non-negative integer.");
  }
  const bytes = Array.from(value.bytes as readonly number[]);
  if (bytes.length === 0) {
    throw new Error("fileField(): magicBytes.bytes must contain at least one byte.");
  }
  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error("fileField(): magicBytes.bytes entries must be integers in [0, 255].");
    }
  }
  const mimes = value.mime === undefined
    ? []
    : typeof value.mime === "string"
      ? [value.mime]
      : [...value.mime];
  return {
    label: value.label ?? bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" "),
    mimes,
    readLength: offset + bytes.length,
    match: (fileBytes) => bytes.every((byte, index) => fileBytes[offset + index] === byte),
  };
}

function normalizeMagicBytesOption(
  option: FileMagicBytesOption | undefined,
  accept: readonly string[] | undefined,
): InternalMagicSignature[] {
  if (option === undefined) return [];
  if (option === true) {
    const patterns = accept ?? [];
    const signatures = KNOWN_MAGIC_SIGNATURES.filter((signature) =>
      signature.mimes.some((mime) => patterns.some((pattern) => mimeMatches(mime, pattern))),
    );
    if (signatures.length === 0) {
      throw new Error(
        "fileField(): magicBytes: true requires accept to include a known sniffable MIME type.",
      );
    }
    return signatures.slice();
  }
  const signatures = Array.isArray(option) ? option : [option];
  return signatures.map(normalizeCustomMagicSignature);
}

/**
 * Heuristics for scriptable / vector image formats that libraries such as
 * ImageMagick treat as code (SVG, MVG, MSL, PostScript / EPS). These are
 * deliberately fuzzy — they look at an ASCII prefix because the real files
 * are text and can be preceded by BOMs, whitespace, XML prologues, or
 * comments. Returning the label here means "refuse this upload".
 */
const SCRIPTABLE_IMAGE_PREFIX_BYTES = 512;

function asciiPrefix(bytes: Uint8Array): string {
  // Strip a UTF-8 / UTF-16 BOM so the trailing keyword sits at the start.
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  } else if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    start = 2;
  }
  let out = "";
  for (let i = start; i < bytes.length; i++) {
    const byte = bytes[i]!;
    // Keep printable ASCII + common whitespace; replace everything else with
    // a space so keyword searches still work across NULs / UTF-16 padding.
    out += byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)
      ? String.fromCharCode(byte)
      : " ";
  }
  return out.toLowerCase();
}

function detectScriptableImagePayload(bytes: Uint8Array): string | undefined {
  const prefix = asciiPrefix(bytes);
  // PostScript / EPS — "%!PS" is the canonical Adobe header.
  if (prefix.startsWith("%!ps") || prefix.includes("%!ps-adobe")) {
    return "postscript";
  }
  // ImageMagick MVG / MSL — vector / scripting formats that can shell out
  // through the `url:`, `ephemeral:`, `msl:` coders (ImageTragick).
  if (prefix.includes("push graphic-context") || prefix.startsWith("<msl>") || prefix.includes("<image ")) {
    return "mvg-or-msl";
  }
  // SVG — XML-based and routinely carries `<script>` / external references.
  // Match both raw `<svg` and an `<?xml ...?>` prologue that introduces SVG.
  const trimmed = prefix.trimStart();
  if (trimmed.startsWith("<svg") || /<!doctype\s+svg/.test(trimmed)) {
    return "svg";
  }
  if (trimmed.startsWith("<?xml") && /<svg[\s>]/.test(trimmed)) {
    return "svg";
  }
  return undefined;
}

async function verifyMagicBytes(
  file: UploadedFile,
  signatures: readonly InternalMagicSignature[],
): Promise<string | undefined> {
  if (signatures.length === 0) return undefined;
  const readLength = Math.max(...signatures.map((signature) => signature.readLength));
  const bytes = new Uint8Array(await file.slice(0, readLength).arrayBuffer());
  const matched = signatures.filter((signature) => signature.match(bytes));
  if (matched.length === 0) {
    return `File magic bytes did not match: ${signatures.map((signature) => signature.label).join(", ")}`;
  }
  const declared = file.type || "";
  if (declared) {
    const mimeAwareMatches = matched.filter((signature) => signature.mimes.length > 0);
    if (
      mimeAwareMatches.length > 0 &&
      !mimeAwareMatches.some((signature) =>
        signature.mimes.some((mime) => mimeMatches(declared, mime)),
      )
    ) {
      return `Declared MIME "${declared}" does not match sniffed magic bytes: ${matched.map((signature) => signature.label).join(", ")}`;
    }
  }
  return undefined;
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
  const magicSignatures = normalizeMagicBytesOption(opts.magicBytes, opts.accept);
  const scriptableImagesEnabled =
    opts.rejectScriptableImages === undefined
      ? opts.magicBytes !== undefined
      : opts.rejectScriptableImages;

  const schema: FileFieldSchema<UploadedFile | null | undefined> = {
    "~standard": {
      version: 1,
      vendor: "daloyjs",
      async validate(value): Promise<StandardSchemaV1.Result<UploadedFile | null | undefined>> {
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
        if (scriptableImagesEnabled) {
          const probeLength = Math.max(
            SCRIPTABLE_IMAGE_PREFIX_BYTES,
            ...magicSignatures.map((signature) => signature.readLength),
          );
          const prefix = new Uint8Array(
            await file.slice(0, Math.min(probeLength, file.size)).arrayBuffer(),
          );
          const scriptable = detectScriptableImagePayload(prefix);
          if (scriptable) {
            return {
              issues: [
                {
                  message:
                    `Refusing scriptable image format "${scriptable}": this format can execute code in ` +
                    `renderers like ImageMagick. Pass rejectScriptableImages: false to opt out.`,
                },
              ],
            };
          }
        }
        const magicError = await verifyMagicBytes(file, magicSignatures);
        if (magicError) return { issues: [{ message: magicError }] };
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

/** Record mapping field names to per-field Standard-Schema validators for {@link multipartObject}. */
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
