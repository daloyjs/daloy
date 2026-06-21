/**
 * Inbound request-decompression bomb guard.
 *
 * DaloyJS core deliberately does **not** decompress request bodies — it is safe
 * by omission, so a `Content-Encoding: gzip` request body is read as-is and a
 * schema parse simply fails on the compressed bytes. Some services, though,
 * genuinely need to accept compressed uploads (chatty IoT clients, log
 * shippers, mobile apps on slow links). The moment you inflate attacker-supplied
 * bytes you inherit the classic **decompression bomb** (a.k.a. "zip bomb"): a
 * few kilobytes of crafted gzip can expand to gigabytes and blow straight past
 * {@link "./app.js".AppOptions.bodyLimitBytes}, which only ever sees the small
 * compressed payload.
 *
 * {@link requestDecompression} is the opt-in middleware that adds request
 * decompression **with the bomb guard baked in**. It inflates the body with two
 * independent caps enforced *during* inflation (so a bomb is aborted long before
 * it is fully materialised):
 *
 * - an **absolute** cap (`maxDecompressedBytes`) — the inflated body may never
 *   exceed this many bytes; and
 * - a **ratio** cap (`maxRatio`) — the inflated size may never exceed
 *   `compressedBytes * maxRatio`, which catches small-but-explosive payloads
 *   that stay under the absolute cap in isolation but would amplify wildly.
 *
 * The compressed input itself is bounded by `maxCompressedBytes` before a single
 * byte is inflated. Built on the web-standard `DecompressionStream`, so the same
 * line works on Node, Bun, Deno, Cloudflare Workers, and Vercel. Zero
 * runtime dependencies.
 *
 * The middleware runs in the {@link "./types.js".Hooks.onRequest} phase — before
 * the per-request context (and therefore before schema-body validation) is
 * built — and stashes the inflated bytes on the request so the framework's own
 * body reader transparently sees the decompressed payload. That means it works
 * for both schema-validated bodies and handlers that read the raw body
 * themselves. Register it globally with `app.use(requestDecompression(...))`.
 *
 * Secure-by-default posture:
 * - Only `gzip` and `deflate` are accepted (the encodings `DecompressionStream`
 *   implements across runtimes). An unknown, unsupported, or **layered**
 *   (`gzip, gzip`) `Content-Encoding` is refused with `415` — never inflated.
 * - Malformed compressed input is refused with `400`, never silently treated as
 *   an empty body.
 * - The bomb caps are mandatory: there is no "unlimited" mode.
 *
 * @module
 * @since 0.37.0
 */

import { HttpError, PayloadTooLargeError } from "./errors.js";
import { readBodyLimited } from "./security.js";
import type { Hooks } from "./types.js";

/**
 * Internal Symbol (shared via the global registry, same key the adapters and
 * {@link "./security.js".readBodyLimited} use) under which a pre-resolved
 * request body is stashed. Setting it lets the framework's body reader skip the
 * stream and return our inflated bytes directly. Referenced via `Symbol.for`
 * rather than imported to avoid an `app.ts` import cycle.
 */
const REQUEST_RAW_BODY = Symbol.for("daloyjs.request.rawBody");

/** Default cap on the compressed request body (bytes) before inflation: 1 MiB. */
const DEFAULT_MAX_COMPRESSED_BYTES = 1024 * 1024;

/** Default maximum inflated:compressed expansion ratio. */
const DEFAULT_MAX_RATIO = 100;

/**
 * Request `Content-Encoding` values this guard can safely inflate. Limited to
 * the formats the web-standard `DecompressionStream` implements consistently
 * across runtimes (brotli is intentionally excluded — it is not part of the
 * Compression Streams spec and is unavailable on most runtimes).
 *
 * @since 0.37.0
 */
export type RequestDecompressionEncoding = "gzip" | "deflate";

/**
 * Details of a rejected decompression bomb, passed to
 * {@link RequestDecompressionOptions.onBomb} and carried by
 * {@link DecompressionBombError}.
 *
 * @since 0.37.0
 */
export interface DecompressionBombInfo {
  /** The declared request `Content-Encoding` that was being inflated. */
  encoding: RequestDecompressionEncoding;
  /** Size of the compressed input, in bytes. */
  compressedBytes: number;
  /** Inflated bytes produced before the guard aborted (always over a cap). */
  decompressedBytes: number;
  /** Which cap tripped: the absolute byte cap or the expansion-ratio cap. */
  reason: "absolute" | "ratio";
}

/**
 * `413 Payload Too Large` raised when an inflating request body crosses either
 * the absolute (`maxDecompressedBytes`) or ratio (`maxRatio`) cap. Thrown
 * *during* inflation, so the full bomb is never materialised in memory.
 *
 * @since 0.37.0
 */
export class DecompressionBombError extends HttpError {
  /** Structured details about the rejected bomb. */
  readonly info: DecompressionBombInfo;
  constructor(info: DecompressionBombInfo) {
    super(413, {
      type: "https://daloyjs.dev/errors/decompression-bomb",
      title: "Payload Too Large",
      detail:
        info.reason === "ratio"
          ? `Decompressed body exceeded the allowed expansion ratio for ${info.encoding} content`
          : `Decompressed body exceeded the maximum allowed size for ${info.encoding} content`,
    });
    this.name = "DecompressionBombError";
    this.info = info;
  }
}

/**
 * `415 Unsupported Media Type` raised when a request declares a
 * `Content-Encoding` this guard cannot safely inflate — an unknown encoding, an
 * encoding not in the configured allowlist, an encoding the runtime's
 * `DecompressionStream` does not implement, or a layered encoding such as
 * `gzip, gzip`. The body is refused, never inflated.
 *
 * @since 0.37.0
 */
export class UnsupportedContentEncodingError extends HttpError {
  constructor(encoding: string, allowed: readonly string[]) {
    super(
      415,
      {
        type: "https://daloyjs.dev/errors/unsupported-content-encoding",
        title: "Unsupported Media Type",
        detail: `Unsupported request Content-Encoding "${encoding}". Allowed: ${allowed.join(", ")}`,
      },
      { "accept-encoding": allowed.join(", ") }
    );
    this.name = "UnsupportedContentEncodingError";
  }
}

/**
 * `400 Bad Request` raised when the compressed request body is not valid for its
 * declared `Content-Encoding` (truncated or corrupt stream). Refusing — rather
 * than treating a malformed body as empty — prevents request-smuggling-style
 * desync between this guard and any downstream parser.
 *
 * @since 0.37.0
 */
export class MalformedCompressedBodyError extends HttpError {
  constructor(encoding: RequestDecompressionEncoding) {
    super(400, {
      type: "https://daloyjs.dev/errors/malformed-compressed-body",
      title: "Bad Request",
      detail: `Request body is not a valid ${encoding} stream`,
    });
    this.name = "MalformedCompressedBodyError";
  }
}

/**
 * Options for {@link requestDecompression} and {@link decompressRequestBody}.
 *
 * @since 0.37.0
 */
export interface RequestDecompressionOptions {
  /**
   * Absolute hard cap (in bytes) on the inflated body. Required — there is no
   * unlimited mode. Inflation aborts the moment output crosses this value, so a
   * bomb is never fully materialised. Must be a positive integer.
   *
   * Set this at or below your {@link "./app.js".AppOptions.bodyLimitBytes} so the
   * inflated payload still fits the body the rest of the app expects.
   */
  maxDecompressedBytes: number;
  /**
   * Cap (in bytes) on the *compressed* input accepted before inflation. The
   * compressed body is read with this limit, so an oversized upload is rejected
   * with `413` without inflating anything. Default `1048576` (1 MiB). Must be a
   * positive integer.
   */
  maxCompressedBytes?: number;
  /**
   * Maximum allowed inflated:compressed expansion ratio. The inflated body may
   * not exceed `compressedBytes * maxRatio`; crossing it aborts inflation with
   * `413`. Default `100`. Must be a finite number `>= 1`.
   */
  maxRatio?: number;
  /**
   * Allowed request encodings. Defaults to `["gzip", "deflate"]`. Any encoding
   * outside this set (or unsupported by the runtime) is refused with `415`.
   */
  encodings?: readonly RequestDecompressionEncoding[];
  /**
   * Optional observability callback invoked when a bomb is rejected, before the
   * `413` is thrown. Receives the structured {@link DecompressionBombInfo}. Must
   * not throw.
   */
  onBomb?: (info: DecompressionBombInfo) => void;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(
      `requestDecompression(): \`${label}\` must be a positive integer, received ${String(value)}`
    );
  }
}

let cachedRuntimeSupport: Set<RequestDecompressionEncoding> | null = null;

/**
 * Probe (once) which encodings the runtime's `DecompressionStream` implements.
 * Mirrors the `compression()` response-side runtime probe.
 *
 * @internal
 */
function detectRuntimeSupport(): Set<RequestDecompressionEncoding> {
  if (cachedRuntimeSupport) return cachedRuntimeSupport;
  const Stream = (
    globalThis as unknown as {
      DecompressionStream?: new (format: string) => unknown;
    }
  ).DecompressionStream;
  const supported = new Set<RequestDecompressionEncoding>();
  if (Stream) {
    for (const enc of ["gzip", "deflate"] as const) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _probe = new Stream(enc);
        supported.add(enc);
      } catch {
        // not supported on this runtime
      }
    }
  }
  cachedRuntimeSupport = supported;
  return supported;
}

/**
 * @internal Reset the cached `DecompressionStream` runtime probe. Test-only.
 * @since 0.37.0
 */
export function _resetRequestDecompressionProbeForTests(): void {
  cachedRuntimeSupport = null;
}

interface ResolvedCaps {
  maxDecompressedBytes: number;
  maxRatio: number;
  onBomb: ((info: DecompressionBombInfo) => void) | undefined;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
}

/**
 * Inflate `compressed` under `encoding` while enforcing the absolute-size and
 * expansion-ratio caps *during* decompression. This is the low-level guard used
 * by {@link requestDecompression}; it is exported so handlers that read raw
 * bodies (or custom flows) can decompress request bytes with the same
 * bomb-resistant semantics.
 *
 * @param compressed - The compressed request bytes.
 * @param encoding - The declared `Content-Encoding` (`"gzip"` or `"deflate"`).
 * @param opts - Caps; only the size/ratio/`onBomb` fields are consulted here.
 * @returns The inflated body as a `Uint8Array`.
 * @throws {DecompressionBombError} When an inflating cap is exceeded (`413`).
 * @throws {MalformedCompressedBodyError} When the input is not a valid stream (`400`).
 * @throws {UnsupportedContentEncodingError} When the runtime cannot inflate the encoding (`415`).
 * @since 0.37.0
 */
export async function decompressRequestBody(
  compressed: Uint8Array,
  encoding: RequestDecompressionEncoding,
  opts: RequestDecompressionOptions
): Promise<Uint8Array> {
  assertPositiveInteger(opts.maxDecompressedBytes, "maxDecompressedBytes");
  const maxRatio = opts.maxRatio ?? DEFAULT_MAX_RATIO;
  if (!Number.isFinite(maxRatio) || maxRatio < 1) {
    throw new TypeError(
      `requestDecompression(): \`maxRatio\` must be a finite number >= 1, received ${String(maxRatio)}`
    );
  }
  return inflateGuarded(compressed, encoding, {
    maxDecompressedBytes: opts.maxDecompressedBytes,
    maxRatio,
    onBomb: opts.onBomb,
  });
}

async function inflateGuarded(
  compressed: Uint8Array,
  encoding: RequestDecompressionEncoding,
  caps: ResolvedCaps
): Promise<Uint8Array> {
  // An empty body has nothing to inflate; treat it as an empty payload rather
  // than feeding an invalid (zero-byte) stream to DecompressionStream.
  if (compressed.byteLength === 0) return new Uint8Array(0);

  const Stream = (
    globalThis as unknown as {
      DecompressionStream?: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).DecompressionStream;
  if (!Stream || !detectRuntimeSupport().has(encoding)) {
    throw new UnsupportedContentEncodingError(encoding, [encoding]);
  }

  const ds = new Stream(encoding);
  const writer = ds.writable.getWriter();
  // Feed the whole compressed payload, then close. Errors on the write/close
  // side (malformed stream) surface as a rejected close; capture rather than
  // leak an unhandled rejection.
  let writeError = false;
  void writer.write(compressed).catch(() => {
    writeError = true;
  });
  const closePromise = writer.close().catch(() => {
    writeError = true;
  });

  const ratioCapBytes = compressed.byteLength * caps.maxRatio;
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > caps.maxDecompressedBytes) {
        await cancelReader(reader);
        const info: DecompressionBombInfo = {
          encoding,
          compressedBytes: compressed.byteLength,
          decompressedBytes: total,
          reason: "absolute",
        };
        caps.onBomb?.(info);
        throw new DecompressionBombError(info);
      }
      if (total > ratioCapBytes) {
        await cancelReader(reader);
        const info: DecompressionBombInfo = {
          encoding,
          compressedBytes: compressed.byteLength,
          decompressedBytes: total,
          reason: "ratio",
        };
        caps.onBomb?.(info);
        throw new DecompressionBombError(info);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof DecompressionBombError) throw err;
    throw new MalformedCompressedBodyError(encoding);
  }
  await closePromise;
  if (writeError) throw new MalformedCompressedBodyError(encoding);

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Opt-in middleware that decompresses inbound request bodies behind a
 * decompression-bomb guard. Inflates `gzip` / `deflate` request bodies under an
 * absolute size cap and an expansion-ratio cap, then hands the inflated bytes to
 * the framework's normal body pipeline so schema validation and raw-body reads
 * both see the decompressed payload.
 *
 * Register it globally so it runs before the per-request context is built:
 *
 * ```ts
 * app.use(requestDecompression({
 *   maxDecompressedBytes: 1024 * 1024, // inflated body never exceeds 1 MiB
 *   maxCompressedBytes: 64 * 1024,     // reject compressed uploads over 64 KiB
 *   maxRatio: 50,                      // and never expand more than 50x
 * }));
 * ```
 *
 * Requests without a `Content-Encoding` (or `identity`) pass through untouched.
 * `GET` / `HEAD` requests are never decompressed. Unknown, unsupported, or
 * layered encodings are refused with `415`; malformed streams with `400`; bombs
 * with `413` (thrown mid-inflation).
 *
 * @param opts - Bomb-guard caps and the encoding allowlist. `maxDecompressedBytes` is required.
 * @returns A {@link "./types.js".Hooks} bundle exposing only an `onRequest` hook.
 * @throws {TypeError} At construction when a cap is invalid.
 * @since 0.37.0
 */
export function requestDecompression(opts: RequestDecompressionOptions): Hooks {
  assertPositiveInteger(opts.maxDecompressedBytes, "maxDecompressedBytes");
  const maxCompressedBytes = opts.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_BYTES;
  assertPositiveInteger(maxCompressedBytes, "maxCompressedBytes");
  const maxRatio = opts.maxRatio ?? DEFAULT_MAX_RATIO;
  if (!Number.isFinite(maxRatio) || maxRatio < 1) {
    throw new TypeError(
      `requestDecompression(): \`maxRatio\` must be a finite number >= 1, received ${String(maxRatio)}`
    );
  }
  const allowed = (opts.encodings ?? ["gzip", "deflate"]).map((e) =>
    e.toLowerCase()
  ) as RequestDecompressionEncoding[];
  if (allowed.length === 0) {
    throw new TypeError("requestDecompression(): `encodings` must contain at least one encoding");
  }
  for (const enc of allowed) {
    if (enc !== "gzip" && enc !== "deflate") {
      throw new TypeError(
        `requestDecompression(): unsupported encoding "${enc}"; only "gzip" and "deflate" are supported`
      );
    }
  }
  const allowedSet = new Set<RequestDecompressionEncoding>(allowed);
  const caps: ResolvedCaps = {
    maxDecompressedBytes: opts.maxDecompressedBytes,
    maxRatio,
    onBomb: opts.onBomb,
  };

  return {
    async onRequest(request: Request): Promise<void> {
      const ceRaw = request.headers.get("content-encoding");
      if (!ceRaw) return;
      const ce = ceRaw.trim().toLowerCase();
      if (ce === "" || ce === "identity") return;

      // Layered encodings (e.g. "gzip, gzip") are a classic nested-bomb vector;
      // refuse rather than inflate recursively.
      const parts = ce
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length !== 1) {
        throw new UnsupportedContentEncodingError(ce, allowed);
      }
      const encoding = parts[0] as RequestDecompressionEncoding;
      if (!allowedSet.has(encoding) || !detectRuntimeSupport().has(encoding)) {
        throw new UnsupportedContentEncodingError(parts[0]!, allowed);
      }

      // Bodyless methods carry nothing to inflate.
      const method = request.method.toUpperCase();
      if (method === "GET" || method === "HEAD") return;

      // Read the compressed body under the compressed-size cap (413 if over).
      const compressed = await readBodyLimited(request, maxCompressedBytes);
      const target = request as unknown as Record<symbol, unknown>;
      if (compressed.byteLength === 0) {
        target[REQUEST_RAW_BODY] = compressed;
        return;
      }

      const inflated = await inflateGuarded(compressed, encoding, caps);
      // Defense in depth: the inflated body must still fit the absolute cap.
      if (inflated.byteLength > caps.maxDecompressedBytes) {
        throw new PayloadTooLargeError(caps.maxDecompressedBytes);
      }
      // Stash the inflated bytes so the framework's body reader returns them
      // transparently (schema-validated bodies and raw-body handlers alike).
      target[REQUEST_RAW_BODY] = inflated;
    },
  };
}
