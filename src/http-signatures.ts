/**
 * HTTP Message Signatures (RFC 9421).
 *
 * First-party, dependency-free sign + verify for server-to-server request
 * authentication. Where {@link "./security.js" | verifyWebhookSignature} binds
 * an HMAC to a request *body* and {@link "./mtls.js" | clientCertAuth}
 * authenticates the TLS *peer*, HTTP Message Signatures bind a signature to a
 * caller-chosen set of **HTTP message components** (method, path, authority,
 * selected headers, …) carried in the standard `Signature` /
 * `Signature-Input` headers — the IETF-standard answer to "prove this internal
 * call came from a trusted peer."
 *
 * The implementation is runtime-portable (WebCrypto only — no `node:` imports)
 * and secure-by-default on the verify path:
 *
 * - The verifier requires an explicit {@link VerifyMessageOptions.algorithms}
 *   allowlist; there is no implicit "accept any algorithm" mode, and a
 *   resolved key may pin its own algorithm to defeat algorithm-confusion.
 * - `created` is required by default and the signature is rejected once it is
 *   older than {@link DEFAULT_MAX_SIGNATURE_AGE_SECONDS}, or if `created` is in
 *   the future / `expires` has passed (outside a small clock-skew tolerance).
 * - A configurable {@link VerifyMessageOptions.requiredComponents} set must be
 *   covered, so a peer cannot sign an empty/irrelevant component set.
 * - Raw HMAC keys must be at least 32 bytes (RFC 7518 §3.2 floor); SHA-1 and
 *   `alg: "none"`-style escapes do not exist.
 *
 * Supported algorithms map 1:1 onto the RFC 9421 HTTP Signature Algorithms
 * registry: `hmac-sha256`, `ed25519`, `ecdsa-p256-sha256`, `ecdsa-p384-sha384`,
 * `rsa-pss-sha512`, and `rsa-v1_5-sha256`.
 *
 * @module
 * @since 0.37.0
 */

import { UnauthorizedError } from "./errors.js";
import type { BaseContext, Hooks } from "./types.js";

/**
 * HTTP Signature algorithm identifiers from the RFC 9421 registry that this
 * module can sign and verify with.
 *
 * @since 0.37.0
 */
export type HttpSignatureAlgorithm =
  | "hmac-sha256"
  | "ed25519"
  | "ecdsa-p256-sha256"
  | "ecdsa-p384-sha384"
  | "rsa-pss-sha512"
  | "rsa-v1_5-sha256";

/** Key material accepted by the signer/verifier. */
export type HttpSignatureKeyMaterial = CryptoKey | Uint8Array | JsonWebKey;

/**
 * A resolved verification key, optionally pinning the algorithm it may be used
 * with. Returning the `alg` from {@link VerifyMessageOptions.resolveKey}
 * defeats algorithm-confusion: the signature's declared `alg` must then match.
 *
 * @since 0.37.0
 */
export interface HttpSignatureKey {
  /** Algorithm this key is bound to. When set, the message `alg` must match. */
  alg?: HttpSignatureAlgorithm;
  /** Raw secret (HMAC), `CryptoKey`, or JWK. */
  key: HttpSignatureKeyMaterial;
}

/** Default signature label used when the caller does not supply one. */
export const DEFAULT_SIGNATURE_LABEL = "sig1";

/**
 * Default maximum age (seconds) a signature's `created` timestamp may have
 * before the verifier rejects it as stale. Mirrors the webhook-HMAC and
 * Standard-Webhooks five-minute convention.
 *
 * @since 0.37.0
 */
export const DEFAULT_MAX_SIGNATURE_AGE_SECONDS = 300;

/** Default clock-skew tolerance (seconds) for future `created` / `expires`. */
export const DEFAULT_SIGNATURE_CLOCK_SKEW_SECONDS = 60;

/** Hard cap on the length of a parsed `Signature` / `Signature-Input` header. */
const MAX_HEADER_LENGTH = 8192;

/** Minimum byte length for a raw HMAC secret (RFC 7518 §3.2). */
const MIN_HMAC_KEY_BYTES = 32;

/**
 * Minimum RSA modulus size accepted for `rsa-*` signature algorithms. NIST
 * SP 800-131A has disallowed RSA keys shorter than 2048 bits since 2014; the
 * JWT verifier ({@link file://./jwt.ts}) enforces the same floor, so the HTTP
 * Message Signatures path holds the parity to keep undersized (crackable) RSA
 * keys out of every signature-verification surface in the framework.
 */
const MIN_RSA_KEY_BITS = 2048;

const ENC = new TextEncoder();

// ---------------------------------------------------------------------------
// WebCrypto + encoding helpers
// ---------------------------------------------------------------------------

function getCrypto(): Crypto {
  const c: Crypto | undefined = (globalThis as unknown as { crypto?: Crypto })
    .crypto;
  if (!c?.subtle) {
    throw new Error(
      "http-signatures: WebCrypto SubtleCrypto API is unavailable on this runtime.",
    );
  }
  return c;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function isJsonWebKey(v: unknown): v is JsonWebKey {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { kty?: unknown }).kty === "string"
  );
}

function isCryptoKey(v: unknown): v is CryptoKey {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string" &&
    typeof (v as { algorithm?: unknown }).algorithm === "object"
  );
}

interface AlgSpec {
  /** WebCrypto import algorithm. */
  importParams: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams;
  /** WebCrypto sign/verify algorithm. */
  signParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  /** Whether this is a symmetric (HMAC) algorithm. */
  symmetric: boolean;
}

function algSpec(alg: HttpSignatureAlgorithm): AlgSpec {
  switch (alg) {
    case "hmac-sha256":
      return {
        importParams: { name: "HMAC", hash: "SHA-256" },
        signParams: { name: "HMAC" },
        symmetric: true,
      };
    case "ed25519":
      return {
        importParams: { name: "Ed25519" },
        signParams: { name: "Ed25519" },
        symmetric: false,
      };
    case "ecdsa-p256-sha256":
      return {
        importParams: { name: "ECDSA", namedCurve: "P-256" },
        signParams: { name: "ECDSA", hash: "SHA-256" },
        symmetric: false,
      };
    case "ecdsa-p384-sha384":
      return {
        importParams: { name: "ECDSA", namedCurve: "P-384" },
        signParams: { name: "ECDSA", hash: "SHA-384" },
        symmetric: false,
      };
    case "rsa-pss-sha512":
      return {
        importParams: { name: "RSA-PSS", hash: "SHA-512" },
        signParams: { name: "RSA-PSS", saltLength: 64 },
        symmetric: false,
      };
    case "rsa-v1_5-sha256":
      return {
        importParams: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        signParams: { name: "RSASSA-PKCS1-v1_5" },
        symmetric: false,
      };
  }
}

/**
 * Refuse RSA keys whose modulus is shorter than {@link MIN_RSA_KEY_BITS}.
 *
 * Only applies to the `rsa-*` algorithms — non-RSA keys are ignored. Every RSA
 * `CryptoKey` carries a numeric `algorithm.modulusLength`; when WebCrypto
 * reports a length below the floor the key is refused for both signing and
 * verification. Mirrors the JWT verifier's `assertRsaModulusFloor` so no
 * signature surface in the framework accepts an undersized RSA key.
 *
 * @param alg - The HTTP signature algorithm the key will be used with.
 * @param key - The imported (or caller-supplied) `CryptoKey`.
 * @throws {TypeError} When `alg` is RSA and the modulus is under the floor.
 */
function assertRsaModulusFloor(alg: HttpSignatureAlgorithm, key: CryptoKey): void {
  if (alg !== "rsa-pss-sha512" && alg !== "rsa-v1_5-sha256") return;
  const algorithm = key.algorithm as { modulusLength?: unknown };
  const modulusLength = algorithm?.modulusLength;
  if (typeof modulusLength !== "number" || !Number.isFinite(modulusLength)) return;
  if (modulusLength < MIN_RSA_KEY_BITS) {
    throw new TypeError(
      `http-signatures: ${alg} key modulus must be at least ${MIN_RSA_KEY_BITS} bits (NIST SP 800-131A); got ${modulusLength}.`,
    );
  }
}

async function importKey(
  alg: HttpSignatureAlgorithm,
  material: HttpSignatureKeyMaterial,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  const spec = algSpec(alg);
  const c = getCrypto();
  if (isCryptoKey(material)) {
    assertRsaModulusFloor(alg, material);
    return material;
  }
  if (material instanceof Uint8Array) {
    if (!spec.symmetric) {
      throw new TypeError(
        `http-signatures: raw byte keys are only supported for hmac-sha256; got ${alg}.`,
      );
    }
    if (material.byteLength < MIN_HMAC_KEY_BYTES) {
      throw new TypeError(
        `http-signatures: hmac-sha256 secret must be at least ${MIN_HMAC_KEY_BYTES} bytes (RFC 7518 §3.2); got ${material.byteLength}.`,
      );
    }
    return c.subtle.importKey(
      "raw",
      material as BufferSource,
      spec.importParams,
      false,
      [usage],
    );
  }
  if (isJsonWebKey(material)) {
    const key = await c.subtle.importKey("jwk", material, spec.importParams, false, [
      usage,
    ]);
    assertRsaModulusFloor(alg, key);
    return key;
  }
  throw new TypeError("http-signatures: unsupported key material.");
}

// ---------------------------------------------------------------------------
// Structured-field serialization (RFC 8941 subset)
// ---------------------------------------------------------------------------

/** Component identifier: a name plus the small subset of params we support. */
interface ComponentId {
  name: string;
  /** `;name="…"` parameter, used by `@query-param`. */
  paramName?: string;
  /** `;req` boolean parameter (response signing, request-bound component). */
  req?: boolean;
}

/** Signature metadata parameters carried on the `@signature-params` line. */
interface SignatureParams {
  created?: number;
  expires?: number;
  keyid?: string;
  alg?: string;
  nonce?: string;
  tag?: string;
}

function serializeSfString(s: string): string {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      throw new TypeError(
        `http-signatures: value contains a non-printable-ASCII character and cannot be serialized as a structured-field string: ${JSON.stringify(s)}`,
      );
    }
  }
  return `"${s.replace(/([\\"])/g, "\\$1")}"`;
}

function serializeComponentId(c: ComponentId): string {
  let out = serializeSfString(c.name);
  if (c.paramName !== undefined) out += `;name=${serializeSfString(c.paramName)}`;
  if (c.req) out += ";req";
  return out;
}

function serializeSignatureInput(
  components: ComponentId[],
  params: SignatureParams,
): string {
  let out = `(${components.map(serializeComponentId).join(" ")})`;
  if (params.created !== undefined) out += `;created=${params.created}`;
  if (params.expires !== undefined) out += `;expires=${params.expires}`;
  if (params.keyid !== undefined) out += `;keyid=${serializeSfString(params.keyid)}`;
  if (params.alg !== undefined) out += `;alg=${serializeSfString(params.alg)}`;
  if (params.nonce !== undefined) out += `;nonce=${serializeSfString(params.nonce)}`;
  if (params.tag !== undefined) out += `;tag=${serializeSfString(params.tag)}`;
  return out;
}

// ---------------------------------------------------------------------------
// Structured-field parsing (RFC 8941 subset)
// ---------------------------------------------------------------------------

class SfParseError extends Error {}

/** Parsed inner list for a single signature label, plus its raw serialization. */
interface ParsedInnerList {
  components: ComponentId[];
  params: SignatureParams;
  /** Exact source substring used verbatim for the `@signature-params` value. */
  raw: string;
}

function readSfString(src: string, start: number): [string, number] {
  if (src[start] !== '"') throw new SfParseError("expected string");
  let i = start + 1;
  let out = "";
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      const next = src[i + 1];
      if (next !== '"' && next !== "\\") throw new SfParseError("bad escape");
      out += next;
      i += 2;
      continue;
    }
    if (ch === '"') return [out, i + 1];
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) throw new SfParseError("bad string char");
    out += ch;
    i++;
  }
  throw new SfParseError("unterminated string");
}

function readKey(src: string, start: number): [string, number] {
  let i = start;
  if (!/[a-z*]/.test(src[i] ?? "")) throw new SfParseError("bad key start");
  let out = "";
  while (i < src.length && /[a-z0-9_\-.*]/.test(src[i]!)) {
    out += src[i];
    i++;
  }
  return [out, i];
}

/** Parse `;key=value` / `;key` params starting at `;`. */
function readParams(
  src: string,
  start: number,
): [Record<string, string | number | boolean>, number] {
  const params: Record<string, string | number | boolean> = Object.create(null);
  let i = start;
  while (i < src.length && src[i] === ";") {
    i++;
    while (src[i] === " ") i++;
    const [key, ni] = readKey(src, i);
    i = ni;
    if (src[i] === "=") {
      i++;
      if (src[i] === '"') {
        const [val, nj] = readSfString(src, i);
        params[key] = val;
        i = nj;
      } else if (src[i] === "?") {
        if (src[i + 1] === "1") params[key] = true;
        else if (src[i + 1] === "0") params[key] = false;
        else throw new SfParseError("bad boolean");
        i += 2;
      } else {
        const m = /^-?\d+/.exec(src.slice(i));
        if (!m) throw new SfParseError("bad param value");
        params[key] = Number(m[0]);
        i += m[0].length;
      }
    } else {
      params[key] = true;
    }
  }
  return [params, i];
}

function toSignatureParams(
  raw: Record<string, string | number | boolean>,
): SignatureParams {
  const out: SignatureParams = {};
  if (typeof raw.created === "number") out.created = raw.created;
  if (typeof raw.expires === "number") out.expires = raw.expires;
  if (typeof raw.keyid === "string") out.keyid = raw.keyid;
  if (typeof raw.alg === "string") out.alg = raw.alg;
  if (typeof raw.nonce === "string") out.nonce = raw.nonce;
  if (typeof raw.tag === "string") out.tag = raw.tag;
  return out;
}

/** Parse one `(...)<params>` inner list starting at `(`. */
function parseInnerList(src: string, start: number): [ParsedInnerList, number] {
  if (src[start] !== "(") throw new SfParseError("expected inner list");
  let i = start + 1;
  const components: ComponentId[] = [];
  while (i < src.length && src[i] !== ")") {
    while (src[i] === " ") i++;
    if (src[i] === ")") break;
    const [name, ni] = readSfString(src, i);
    i = ni;
    const [cParams, nj] = readParams(src, i);
    i = nj;
    const comp: ComponentId = { name };
    if (typeof cParams.name === "string") comp.paramName = cParams.name;
    if (cParams.req === true) comp.req = true;
    components.push(comp);
    while (src[i] === " ") i++;
  }
  if (src[i] !== ")") throw new SfParseError("unterminated inner list");
  i++;
  const [rawParams, nk] = readParams(src, i);
  i = nk;
  const raw = src.slice(start, i).trim();
  return [{ components, params: toSignatureParams(rawParams), raw }, i];
}

/** Parse the `Signature-Input` dictionary into a label → inner-list map. */
function parseSignatureInput(headerValue: string): Map<string, ParsedInnerList> {
  const out = new Map<string, ParsedInnerList>();
  const src = headerValue;
  let i = 0;
  while (i < src.length) {
    while (src[i] === " " || src[i] === "\t" || src[i] === ",") i++;
    if (i >= src.length) break;
    const [label, ni] = readKey(src, i);
    i = ni;
    if (src[i] !== "=") throw new SfParseError("expected = after label");
    i++;
    const [inner, nj] = parseInnerList(src, i);
    i = nj;
    out.set(label, inner);
  }
  return out;
}

/** Parse the `Signature` dictionary into a label → raw bytes map. */
function parseSignature(headerValue: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const src = headerValue;
  let i = 0;
  while (i < src.length) {
    while (src[i] === " " || src[i] === "\t" || src[i] === ",") i++;
    if (i >= src.length) break;
    const [label, ni] = readKey(src, i);
    i = ni;
    if (src[i] !== "=") throw new SfParseError("expected = after label");
    i++;
    if (src[i] !== ":") throw new SfParseError("expected byte sequence");
    const end = src.indexOf(":", i + 1);
    if (end === -1) throw new SfParseError("unterminated byte sequence");
    const b64 = src.slice(i + 1, end);
    const bytes = base64ToBytes(b64);
    if (!bytes) throw new SfParseError("bad base64");
    out.set(label, bytes);
    i = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component value resolution + signature base
// ---------------------------------------------------------------------------

/** Normalized view of the message being signed/verified. */
interface MessageContext {
  method: string;
  url: URL;
  headers: Headers;
  /** Present for response messages; enables `@status`. */
  status?: number;
}

class ComponentError extends Error {}

function resolveComponentValue(c: ComponentId, msg: MessageContext): string {
  const name = c.name;
  if (name === "@signature-params") {
    throw new ComponentError("@signature-params cannot be a covered component");
  }
  if (name.startsWith("@")) {
    if (c.req) {
      throw new ComponentError(
        `the ;req parameter is not supported on ${name} in this context`,
      );
    }
    switch (name) {
      case "@method":
        return msg.method.toUpperCase();
      case "@target-uri":
        return msg.url.href;
      case "@authority":
        return msg.url.host.toLowerCase();
      case "@scheme":
        return msg.url.protocol.replace(/:$/, "").toLowerCase();
      case "@request-target":
        return `${msg.url.pathname}${msg.url.search}`;
      case "@path":
        return msg.url.pathname;
      case "@query":
        return msg.url.search === "" ? "?" : msg.url.search;
      case "@query-param": {
        if (c.paramName === undefined) {
          throw new ComponentError("@query-param requires a ;name parameter");
        }
        const values = msg.url.searchParams.getAll(c.paramName);
        if (values.length === 0) {
          throw new ComponentError(
            `@query-param;name="${c.paramName}" is not present in the query`,
          );
        }
        // Reject multi-value params: signing only the first value while an app
        // or intermediary uses the last value (or the full array) is a classic
        // HTTP parameter-pollution differential. Prefer `@query` / `@target-uri`
        // when multiple values are legitimate.
        if (values.length > 1) {
          throw new ComponentError(
            `@query-param;name="${c.paramName}" appears ${values.length} times; ` +
              "duplicate query parameters are not supported (parameter pollution risk). " +
              "Cover `@query` or `@target-uri` instead, or send a single value.",
          );
        }
        return values[0]!;
      }
      case "@status":
        if (msg.status === undefined) {
          throw new ComponentError("@status is only valid for responses");
        }
        return String(msg.status);
      default:
        throw new ComponentError(`unknown derived component ${name}`);
    }
  }
  // HTTP field component.
  if (name !== name.toLowerCase()) {
    throw new ComponentError(`field component name must be lowercase: ${name}`);
  }
  if (c.req) {
    throw new ComponentError(
      "the ;req parameter is not supported in this context",
    );
  }
  const value = msg.headers.get(name);
  if (value === null) {
    throw new ComponentError(`covered header "${name}" is not present`);
  }
  return value.trim().replace(/[ \t]*\r?\n[ \t]*/g, " ");
}

function buildSignatureBase(
  components: ComponentId[],
  signatureParamsValue: string,
  msg: MessageContext,
): string {
  const seen = new Set<string>();
  let base = "";
  for (const c of components) {
    const id = serializeComponentId(c);
    if (seen.has(id)) {
      throw new ComponentError(`duplicate covered component ${id}`);
    }
    seen.add(id);
    base += `${id}: ${resolveComponentValue(c, msg)}\n`;
  }
  base += `"@signature-params": ${signatureParamsValue}`;
  return base;
}

function toHeaders(init: HeadersInit | undefined): Headers {
  return init instanceof Headers ? init : new Headers(init ?? {});
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Options for {@link signMessage}. Describes the message to cover and the key
 * to sign with.
 *
 * @since 0.37.0
 */
export interface SignMessageOptions {
  /** HTTP method (e.g. `"POST"`). */
  method: string;
  /** Absolute request URL. */
  url: string | URL;
  /** Request headers referenced by header components. */
  headers?: HeadersInit;
  /** Response status code (only when signing a response, for `@status`). */
  status?: number;
  /**
   * Covered component identifiers, in order. Derived components start with `@`
   * (`@method`, `@target-uri`, `@authority`, `@scheme`, `@request-target`,
   * `@path`, `@query`, `@query-param;name="…"`, `@status`); everything else is
   * a lowercased HTTP header name. Defaults to `["@method", "@target-uri"]`.
   */
  components?: string[];
  /** Algorithm to sign with. */
  alg: HttpSignatureAlgorithm;
  /** Signing key (HMAC secret, `CryptoKey`, or JWK). */
  key: HttpSignatureKeyMaterial;
  /** Key identifier surfaced as the `keyid` parameter (recommended). */
  keyid?: string;
  /** Signature label in the dictionary. Defaults to {@link DEFAULT_SIGNATURE_LABEL}. */
  label?: string;
  /** `created` timestamp (Unix seconds). Defaults to the current time. */
  created?: number;
  /** Optional `expires` timestamp (Unix seconds). */
  expires?: number;
  /** Optional `nonce` for replay defense. */
  nonce?: string;
  /** Optional `tag` (application-specific signature label). */
  tag?: string;
  /** Whether to emit the `alg` parameter. Defaults to `true`. */
  includeAlg?: boolean;
  /** Clock used to default `created`. Returns milliseconds. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Computed `Signature` / `Signature-Input` header values plus the signature
 * base that was signed (useful for debugging / interop testing).
 *
 * @since 0.37.0
 */
export interface MessageSignature {
  /** Value for the `Signature-Input` header. */
  signatureInput: string;
  /** Value for the `Signature` header. */
  signature: string;
  /** The exact UTF-8 signature base that was signed. */
  signatureBase: string;
  /** The label used in the dictionary. */
  label: string;
}

function parseComponentSpec(spec: string): ComponentId {
  // Accept the canonical serialized form ("@query-param";name="x") or the
  // bare convenience form `@query-param;name=x`.
  if (spec.startsWith('"')) {
    const [name, idx] = readSfString(spec, 0);
    const [params] = readParams(spec, idx);
    const comp: ComponentId = { name };
    if (typeof params.name === "string") comp.paramName = params.name;
    if (params.req === true) comp.req = true;
    return comp;
  }
  const semi = spec.indexOf(";");
  if (semi === -1) return { name: spec };
  const name = spec.slice(0, semi);
  const comp: ComponentId = { name };
  for (const part of spec.slice(semi + 1).split(";")) {
    if (part === "req") comp.req = true;
    else if (part.startsWith("name=")) {
      comp.paramName = part.slice(5).replace(/^"|"$/g, "");
    }
  }
  return comp;
}

/**
 * Compute HTTP Message Signature header values (RFC 9421) over the described
 * message.
 *
 * @param opts - Message description, covered components, algorithm, and key;
 *   see {@link SignMessageOptions}.
 * @returns The `Signature-Input` / `Signature` header values plus the exact
 *   signature base that was signed.
 * @throws {TypeError} for unsupported algorithms, weak HMAC keys, or
 *   unserializable parameter values.
 * @throws {Error} when a covered component cannot be resolved (e.g. a covered
 *   header is missing) or WebCrypto is unavailable.
 * @since 0.37.0
 */
export async function signMessage(
  opts: SignMessageOptions,
): Promise<MessageSignature> {
  const label = opts.label ?? DEFAULT_SIGNATURE_LABEL;
  const url = opts.url instanceof URL ? opts.url : new URL(opts.url);
  const components = (opts.components ?? ["@method", "@target-uri"]).map(
    parseComponentSpec,
  );
  const nowSeconds = Math.floor((opts.now ?? Date.now)() / 1000);
  const params: SignatureParams = {
    created: opts.created ?? nowSeconds,
    ...(opts.expires !== undefined ? { expires: opts.expires } : {}),
    ...(opts.keyid !== undefined ? { keyid: opts.keyid } : {}),
    ...(opts.includeAlg === false ? {} : { alg: opts.alg }),
    ...(opts.nonce !== undefined ? { nonce: opts.nonce } : {}),
    ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
  };
  const signatureParamsValue = serializeSignatureInput(components, params);
  const msg: MessageContext = {
    method: opts.method,
    url,
    headers: toHeaders(opts.headers),
    ...(opts.status !== undefined ? { status: opts.status } : {}),
  };
  const base = buildSignatureBase(components, signatureParamsValue, msg);

  const key = await importKey(opts.alg, opts.key, "sign");
  const spec = algSpec(opts.alg);
  const sig = new Uint8Array(
    await getCrypto().subtle.sign(
      spec.signParams,
      key,
      ENC.encode(base) as BufferSource,
    ),
  );
  return {
    signatureInput: `${label}=${signatureParamsValue}`,
    signature: `${label}=:${bytesToBase64(sig)}:`,
    signatureBase: base,
    label,
  };
}

/**
 * Options for {@link signRequest}; the method, URL, and headers are taken from
 * the {@link Request} itself.
 *
 * @since 0.37.0
 */
export type SignRequestOptions = Omit<
  SignMessageOptions,
  "method" | "url" | "headers" | "status"
>;

/**
 * Sign an outbound {@link Request} and return a new `Request` with the
 * `Signature` and `Signature-Input` headers attached. The original request is
 * not mutated.
 *
 * @param request - The outbound request to sign; its method, URL, and headers
 *   form the signature base.
 * @param opts - Signing options minus the per-message fields; see
 *   {@link SignRequestOptions}.
 * @returns A new `Request` carrying the signature headers.
 * @since 0.37.0
 */
export async function signRequest(
  request: Request,
  opts: SignRequestOptions,
): Promise<Request> {
  const sig = await signMessage({
    ...opts,
    method: request.method,
    url: request.url,
    headers: request.headers,
  });
  const headers = new Headers(request.headers);
  headers.set("signature-input", sig.signatureInput);
  headers.set("signature", sig.signature);
  return new Request(request, { headers });
}

// ---------------------------------------------------------------------------
// Verifying
// ---------------------------------------------------------------------------

/** Information passed to {@link VerifyMessageOptions.resolveKey}. */
export interface KeyResolutionInfo {
  /** The `keyid` parameter, if the signer included one. */
  keyid?: string;
  /** The declared `alg` parameter, if present. */
  alg?: HttpSignatureAlgorithm;
  /** The signature label being verified. */
  label: string;
  /** The `tag` parameter, if present. */
  tag?: string;
}

/** Successful verification result. */
export interface VerifySuccess {
  /** Discriminant: always `true` on success. */
  valid: true;
  /** The verified signature label. */
  label: string;
  /** Algorithm used. */
  alg: HttpSignatureAlgorithm;
  /** The `keyid` parameter, if present. */
  keyid?: string;
  /** Covered component identifiers (serialized form). */
  components: string[];
  /** `created` timestamp (Unix seconds), if present. */
  created?: number;
  /** `expires` timestamp (Unix seconds), if present. */
  expires?: number;
  /** `nonce` parameter, if present. */
  nonce?: string;
  /** `tag` parameter, if present. */
  tag?: string;
}

/** Failed verification result. Never throws on a bad signature. */
export interface VerifyFailure {
  /** Discriminant: always `false` on failure. */
  valid: false;
  /** Stable machine-readable reason code. */
  reason: string;
}

/** Result of {@link verifyMessage} / {@link verifyRequest}. */
export type VerifyResult = VerifySuccess | VerifyFailure;

/**
 * Options for {@link verifyMessage}. The verifier is secure-by-default: it
 * requires an explicit {@link algorithms} allowlist and a {@link resolveKey}
 * callback.
 *
 * @since 0.37.0
 */
export interface VerifyMessageOptions {
  /** HTTP method of the received message. */
  method: string;
  /** Absolute URL of the received message. */
  url: string | URL;
  /** Headers of the received message (must include `Signature` / `Signature-Input`). */
  headers: HeadersInit;
  /** Response status code (only when verifying a response). */
  status?: number;
  /** Allowed algorithms. Required — there is no implicit "accept any" mode. */
  algorithms: HttpSignatureAlgorithm[];
  /**
   * Resolve the verification key for a signature. Returning an
   * {@link HttpSignatureKey} with `alg` pins the algorithm (defeats
   * algorithm-confusion). Return `undefined` to reject an unknown key.
   */
  resolveKey: (
    info: KeyResolutionInfo,
  ) =>
    | HttpSignatureKey
    | HttpSignatureKeyMaterial
    | undefined
    | Promise<HttpSignatureKey | HttpSignatureKeyMaterial | undefined>;
  /** Which signature label to verify. Defaults to the sole present label. */
  label?: string;
  /**
   * Component identifiers that MUST be covered. Defaults to
   * `["@method", "@target-uri"]` so the verifier binds scheme, authority,
   * path, **and query** (matching {@link signMessage}'s default covered set).
   * Prefer this over bare `@path`, which leaves query parameters unsigned.
   * Pass `[]` to disable the check (not recommended).
   */
  requiredComponents?: string[];
  /** Require the `created` parameter. Defaults to `true`. */
  requireCreated?: boolean;
  /** Maximum `created` age in seconds. Defaults to {@link DEFAULT_MAX_SIGNATURE_AGE_SECONDS}. */
  maxAgeSeconds?: number;
  /** Clock-skew tolerance in seconds. Defaults to {@link DEFAULT_SIGNATURE_CLOCK_SKEW_SECONDS}. */
  toleranceSeconds?: number;
  /** Require this exact `tag` parameter value. */
  requiredTag?: string;
  /**
   * Replay check. When provided, a `nonce` is required and the signature is
   * rejected if this returns `true`.
   */
  isReplay?: (nonce: string, info: KeyResolutionInfo) => boolean | Promise<boolean>;
  /** Clock used for age checks. Returns milliseconds. Defaults to `Date.now`. */
  now?: () => number;
}

function fail(reason: string): VerifyFailure {
  return { valid: false, reason };
}

/**
 * Verify an HTTP Message Signature (RFC 9421) on a received message. Returns a
 * structured result and never throws on a bad/forged signature — only on a
 * programming error (e.g. WebCrypto unavailable).
 *
 * @param opts - Received message plus verification policy (algorithm
 *   allowlist, key resolver, freshness / replay checks); see
 *   {@link VerifyMessageOptions}.
 * @returns A {@link VerifySuccess} with the verified parameters, or a
 *   {@link VerifyFailure} with a stable `reason` code.
 * @throws {TypeError} when the `algorithms` allowlist is missing or empty;
 *   there is no implicit "accept any" mode.
 * @since 0.37.0
 */
export async function verifyMessage(
  opts: VerifyMessageOptions,
): Promise<VerifyResult> {
  if (!Array.isArray(opts.algorithms) || opts.algorithms.length === 0) {
    throw new TypeError(
      "verifyMessage(): an explicit, non-empty `algorithms` allowlist is required.",
    );
  }
  const headers = toHeaders(opts.headers);
  const sigInputRaw = headers.get("signature-input");
  const sigRaw = headers.get("signature");
  if (!sigInputRaw) return fail("missing_signature_input");
  if (!sigRaw) return fail("missing_signature");
  if (sigInputRaw.length > MAX_HEADER_LENGTH || sigRaw.length > MAX_HEADER_LENGTH) {
    return fail("header_too_large");
  }

  let inputs: Map<string, ParsedInnerList>;
  let signatures: Map<string, Uint8Array>;
  try {
    inputs = parseSignatureInput(sigInputRaw);
    signatures = parseSignature(sigRaw);
  } catch {
    return fail("malformed_signature_headers");
  }

  let label = opts.label;
  if (label === undefined) {
    if (inputs.size !== 1) return fail("ambiguous_label");
    label = inputs.keys().next().value!;
  }
  const input = inputs.get(label);
  const provided = signatures.get(label);
  if (!input || !provided) return fail("label_not_found");

  const params = input.params;
  const declaredAlg = params.alg as HttpSignatureAlgorithm | undefined;
  const info: KeyResolutionInfo = {
    label,
    ...(params.keyid !== undefined ? { keyid: params.keyid } : {}),
    ...(declaredAlg !== undefined ? { alg: declaredAlg } : {}),
    ...(params.tag !== undefined ? { tag: params.tag } : {}),
  };

  // Required components.
  // Align with signMessage()'s default covered components so a default sign
  // is accepted by a default verify, and so query/authority cannot be swapped
  // out under a signature that only bound `@path`.
  const requiredComponents = opts.requiredComponents ?? ["@method", "@target-uri"];
  const coveredIds = input.components.map(serializeComponentId);
  for (const req of requiredComponents) {
    const wanted = serializeComponentId(parseComponentSpec(req));
    if (!coveredIds.includes(wanted)) return fail("missing_required_component");
  }

  // Tag check.
  if (opts.requiredTag !== undefined && params.tag !== opts.requiredTag) {
    return fail("tag_mismatch");
  }

  // Time checks.
  const nowSeconds = Math.floor((opts.now ?? Date.now)() / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_SIGNATURE_CLOCK_SKEW_SECONDS;
  const requireCreated = opts.requireCreated !== false;
  if (params.created === undefined) {
    if (requireCreated) return fail("missing_created");
  } else {
    if (params.created - tolerance > nowSeconds) return fail("created_in_future");
    const maxAge = opts.maxAgeSeconds ?? DEFAULT_MAX_SIGNATURE_AGE_SECONDS;
    if (Number.isFinite(maxAge) && nowSeconds - params.created > maxAge) {
      return fail("signature_stale");
    }
  }
  if (params.expires !== undefined && nowSeconds - tolerance > params.expires) {
    return fail("signature_expired");
  }

  // Replay check.
  if (opts.isReplay) {
    if (params.nonce === undefined) return fail("missing_nonce");
    if (await opts.isReplay(params.nonce, info)) return fail("replay_detected");
  }

  // Resolve the key + effective algorithm (defeating algorithm-confusion).
  const resolved = await opts.resolveKey(info);
  if (resolved === undefined) return fail("key_not_found");
  let keyMaterial: HttpSignatureKeyMaterial;
  let pinnedAlg: HttpSignatureAlgorithm | undefined;
  if (
    resolved instanceof Uint8Array ||
    isCryptoKey(resolved) ||
    isJsonWebKey(resolved)
  ) {
    keyMaterial = resolved;
  } else {
    keyMaterial = resolved.key;
    pinnedAlg = resolved.alg;
  }
  const effectiveAlg = pinnedAlg ?? declaredAlg;
  if (effectiveAlg === undefined) return fail("unspecified_alg");
  if (pinnedAlg !== undefined && declaredAlg !== undefined && pinnedAlg !== declaredAlg) {
    return fail("alg_mismatch");
  }
  if (!opts.algorithms.includes(effectiveAlg)) return fail("alg_not_allowed");

  // Rebuild the signature base (verbatim @signature-params value).
  const url = opts.url instanceof URL ? opts.url : new URL(opts.url);
  const msg: MessageContext = {
    method: opts.method,
    url,
    headers,
    ...(opts.status !== undefined ? { status: opts.status } : {}),
  };
  let base: string;
  try {
    base = buildSignatureBase(input.components, input.raw, msg);
  } catch {
    return fail("component_resolution_failed");
  }

  let key: CryptoKey;
  try {
    key = await importKey(effectiveAlg, keyMaterial, "verify");
  } catch {
    return fail("invalid_key");
  }
  const spec = algSpec(effectiveAlg);
  let ok: boolean;
  try {
    ok = await getCrypto().subtle.verify(
      spec.signParams,
      key,
      provided as BufferSource,
      ENC.encode(base) as BufferSource,
    );
  } catch {
    return fail("verify_threw");
  }
  if (!ok) return fail("invalid_signature");

  return {
    valid: true,
    label,
    alg: effectiveAlg,
    components: coveredIds,
    ...(params.keyid !== undefined ? { keyid: params.keyid } : {}),
    ...(params.created !== undefined ? { created: params.created } : {}),
    ...(params.expires !== undefined ? { expires: params.expires } : {}),
    ...(params.nonce !== undefined ? { nonce: params.nonce } : {}),
    ...(params.tag !== undefined ? { tag: params.tag } : {}),
  };
}

/**
 * Verify an HTTP Message Signature on an inbound {@link Request}. Thin wrapper
 * over {@link verifyMessage} that pulls the method, URL, and headers from the
 * request.
 *
 * @param request - The inbound request carrying `Signature` / `Signature-Input`.
 * @param opts - Verification policy minus the per-message fields.
 * @returns The {@link VerifyResult}; never rejects on a bad signature.
 * @since 0.37.0
 */
export function verifyRequest(
  request: Request,
  opts: Omit<VerifyMessageOptions, "method" | "url" | "headers" | "status">,
): Promise<VerifyResult> {
  return verifyMessage({
    ...opts,
    method: request.method,
    url: request.url,
    headers: request.headers,
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Options for {@link httpSignatureAuth}. Extends {@link VerifyMessageOptions}
 * minus the per-message fields (which come from the request).
 *
 * @since 0.37.0
 */
export interface HttpSignatureAuthOptions
  extends Omit<VerifyMessageOptions, "method" | "url" | "headers" | "status"> {
  /** Detail surfaced on the 401 problem+json response. */
  message?: string;
  /** `ctx.state` key the {@link VerifySuccess} is stamped on. Default `"httpSignature"`. */
  stateKey?: string;
  /**
   * When `true`, requests **without** any `Signature` header pass through
   * unauthenticated (a present-but-invalid signature is still rejected).
   * Defaults to `false` — signatures are mandatory.
   */
  optional?: boolean;
}

/**
 * Middleware that enforces a valid RFC 9421 HTTP Message Signature on inbound
 * requests. On success the {@link VerifySuccess} is stamped on `ctx.state`; on
 * a missing (unless `optional`) or invalid signature it throws
 * {@link UnauthorizedError} (`401` + `Cache-Control: no-store`).
 *
 * @param opts - Verification policy plus middleware knobs; see
 *   {@link HttpSignatureAuthOptions}.
 * @returns A {@link Hooks} object to pass to `app.use()` or a route's `hooks`.
 * @since 0.37.0
 */
export function httpSignatureAuth(opts: HttpSignatureAuthOptions): Hooks {
  const stateKey = opts.stateKey ?? "httpSignature";
  const message = opts.message ?? "Valid HTTP message signature required";
  const authHooks: Hooks = {
    async beforeHandle(ctx: BaseContext<any, any>) {
      const headers = ctx.request.headers;
      if (opts.optional && !headers.has("signature")) return undefined;
      const result = await verifyRequest(ctx.request, opts);
      if (!result.valid) {
        throw new UnauthorizedError(`${message} (${result.reason})`);
      }
      (ctx.state as Record<string, unknown>)[stateKey] = result;
      return undefined;
    },
  };
  // Same global symbol as middleware's AUTH_HOOK_MARKER (stamped inline to keep
  // the middleware module out of this bundle): lets the route-auth boot guard
  // recognize that a route declaring `auth:` is actually enforced here.
  (authHooks as Record<PropertyKey, unknown>)[Symbol.for("daloyjs.auth.hook")] = true;
  return authHooks;
}

// ---------------------------------------------------------------------------
// Content-Digest (RFC 9530) helpers
// ---------------------------------------------------------------------------

/** Hash algorithms supported for {@link contentDigest}. */
export type ContentDigestAlgorithm = "sha-256" | "sha-512";

const CONTENT_DIGEST_HASH: Record<ContentDigestAlgorithm, string> = {
  "sha-256": "SHA-256",
  "sha-512": "SHA-512",
};

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === "string" ? ENC.encode(body) : body;
}

/**
 * Compute an RFC 9530 `Content-Digest` header value over `body`, e.g.
 * `sha-256=:<base64>:`. Pair it with a `content-digest` covered component to
 * bind the request body into the signature, then re-check it against the
 * received body with {@link verifyContentDigest}.
 *
 * @param body - Raw body bytes, or a string encoded as UTF-8.
 * @param opts - Optional `algorithm` choice. Defaults to `"sha-256"`.
 * @returns The structured-field header value, e.g. `sha-256=:<base64>:`.
 * @throws {TypeError} for an unsupported digest algorithm.
 * @since 0.37.0
 */
export async function contentDigest(
  body: Uint8Array | string,
  opts: { algorithm?: ContentDigestAlgorithm } = {},
): Promise<string> {
  const algorithm = opts.algorithm ?? "sha-256";
  const hash = CONTENT_DIGEST_HASH[algorithm];
  if (!hash) {
    throw new TypeError(`contentDigest(): unsupported algorithm ${algorithm}`);
  }
  const digest = new Uint8Array(
    await getCrypto().subtle.digest(hash, toBytes(body) as BufferSource),
  );
  return `${algorithm}=:${bytesToBase64(digest)}:`;
}

/**
 * Verify that an RFC 9530 `Content-Digest` header value matches `body`.
 * Returns `false` for any malformed header or mismatch (never throws on bad
 * input). Only `sha-256` / `sha-512` members are considered.
 *
 * @param header - The received `Content-Digest` header value.
 * @param body - Raw body bytes, or a string encoded as UTF-8.
 * @returns `true` only when at least one supported digest member matched
 *   (compared in constant time); `false` for mismatch or malformed input.
 * @since 0.37.0
 */
export async function verifyContentDigest(
  header: string,
  body: Uint8Array | string,
): Promise<boolean> {
  if (typeof header !== "string" || header.length > MAX_HEADER_LENGTH) {
    return false;
  }
  const bodyBytes = toBytes(body);
  let matchedAny = false;
  for (const member of header.split(",")) {
    const m = /^\s*(sha-256|sha-512)=:([A-Za-z0-9+/]*={0,2}):\s*$/.exec(member);
    if (!m) continue;
    const algorithm = m[1] as ContentDigestAlgorithm;
    const expected = base64ToBytes(m[2]!);
    if (!expected) return false;
    const digest = new Uint8Array(
      await getCrypto().subtle.digest(
        CONTENT_DIGEST_HASH[algorithm],
        bodyBytes as BufferSource,
      ),
    );
    if (digest.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < digest.length; i++) diff |= digest[i]! ^ expected[i]!;
    if (diff !== 0) return false;
    matchedAny = true;
  }
  return matchedAny;
}
