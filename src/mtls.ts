/**
 * Mutual-TLS / client-certificate authentication.
 *
 * The Web-standard {@link Request} does not surface the TLS peer certificate,
 * so — exactly like {@link "./conn-info.js"} does for the peer IP — adapters
 * (or a trusted TLS-terminating reverse proxy) attach a normalized
 * {@link ClientCertificate} to the request, and the {@link clientCertAuth}
 * middleware reads it back to enforce a client-certificate identity for
 * zero-trust / service-to-service deployments.
 *
 * Two population paths are supported, both runtime-portable and dependency-free:
 *
 * 1. **Native TLS** — when the runtime terminates TLS itself (the Node adapter
 *    reads `tls.TLSSocket#getPeerCertificate()`), the adapter stashes a lazy
 *    thunk via {@link setClientCertificate}; the certificate is only normalized
 *    if a `clientCertAuth()`-guarded route actually reads it, so plain requests
 *    pay nothing.
 * 2. **Forwarded by a trusted proxy** — when TLS is terminated upstream
 *    (Envoy, nginx, HAProxy, Traefik, a cloud load balancer), the proxy forwards
 *    the verified client identity in request headers. {@link clientCertAuth}
 *    can parse Envoy's `X-Forwarded-Client-Cert` (XFCC) or a set of operator-named
 *    structured headers (nginx `$ssl_client_*`, etc.). Because those headers are
 *    spoofable by anything that can reach the app directly, the header path is
 *    opt-in and must be paired with a `behindProxy` posture that guarantees the
 *    app is only reachable through the terminating proxy.
 *
 * @module
 * @since 0.37.0
 */

import { ForbiddenError } from "./errors.js";
import { timingSafeEqual } from "./security.js";
import type { Hooks, PreBodyContext } from "./types.js";

/**
 * Normalized view of a TLS client certificate, independent of how it was
 * obtained (native socket vs. forwarded proxy header). Every field except
 * {@link subjectAltNames} and {@link verified} is optional because different
 * sources expose different subsets.
 *
 * @since 0.37.0
 */
export interface ClientCertificate {
  /** Full subject distinguished name, e.g. `"CN=svc-a,OU=payments,O=acme"`. */
  readonly subjectDN?: string;
  /** Subject common name (the `CN=` RDN), if present. */
  readonly subjectCN?: string;
  /** Full issuer distinguished name. */
  readonly issuerDN?: string;
  /** Issuer common name (the `CN=` RDN), if present. */
  readonly issuerCN?: string;
  /** Certificate serial number (hex string), if known. */
  readonly serialNumber?: string;
  /**
   * SHA-256 fingerprint. Normalized to uppercase hex **without** separators
   * (colons stripped) so allow-list comparison is source-independent.
   */
  readonly fingerprint256?: string;
  /**
   * Subject Alternative Names as `TYPE:value` entries (e.g. `"DNS:svc-a.internal"`,
   * `"URI:spiffe://acme/svc-a"`, `"IP:10.0.0.7"`). Empty array when none.
   */
  readonly subjectAltNames: readonly string[];
  /** `notBefore` validity bound, if the source exposed it. */
  readonly notBefore?: Date;
  /** `notAfter` validity bound, if the source exposed it. */
  readonly notAfter?: Date;
  /**
   * Whether the TLS terminator **cryptographically verified** the certificate
   * chain. `clientCertAuth({ requireVerified: true })` (the default) refuses
   * any certificate where this is `false`.
   */
  readonly verified: boolean;
  /** PEM text, when the source forwarded it (XFCC `Cert=`). */
  readonly pem?: string;
}

/**
 * A {@link ClientCertificate} or a lazy thunk that produces one. Adapters stash
 * a thunk so the (potentially expensive) certificate read only happens if a
 * guarded route actually inspects it.
 *
 * @since 0.37.0
 */
export type ClientCertificateSource =
  ClientCertificate | undefined | (() => ClientCertificate | undefined);

const CLIENT_CERT_SYMBOL: unique symbol = Symbol.for("daloyjs.clientCertificate");

/**
 * @internal Adapter helper — attach a {@link ClientCertificate} (or a lazy
 * thunk producing one) to a `Request`. Mirrors {@link "./conn-info.js".setConnInfo}.
 * Pass a thunk to defer the read until {@link getClientCertificate} is first
 * called; the resolved value is cached back onto the request.
 *
 * @param request The incoming request to stash the certificate on.
 * @param source The certificate, a lazy thunk producing one, or `undefined`
 *   when the connection presented no client certificate.
 * @since 0.37.0
 */
export function setClientCertificate(request: Request, source: ClientCertificateSource): void {
  (request as unknown as Record<PropertyKey, unknown>)[CLIENT_CERT_SYMBOL] = source;
}

/**
 * Read the {@link ClientCertificate} an adapter attached to this request, or
 * `undefined` when the connection presented no client certificate (or the
 * adapter does not expose TLS peer info). If a lazy thunk was stashed, it is
 * resolved once and the result cached.
 *
 * @param request The request previously seen by {@link setClientCertificate}.
 * @returns The attached certificate, or `undefined` when none was presented.
 * @since 0.37.0
 */
export function getClientCertificate(request: Request): ClientCertificate | undefined {
  const store = request as unknown as Record<PropertyKey, unknown>;
  const source = store[CLIENT_CERT_SYMBOL] as ClientCertificateSource;
  if (typeof source === "function") {
    const resolved = source();
    store[CLIENT_CERT_SYMBOL] = resolved;
    return resolved;
  }
  return source;
}

/**
 * Shape of the object returned by Node's `tls.TLSSocket#getPeerCertificate(true)`.
 * Declared structurally so {@link normalizePeerCertificate} stays dependency-free
 * and importable in non-Node runtimes.
 *
 * @since 0.37.0
 */
export interface PeerCertificateLike {
  /** Subject RDN attributes keyed by short name (e.g. `CN`, `O`). */
  subject?: Record<string, string | string[]> | null;
  /** Issuer RDN attributes keyed by short name. */
  issuer?: Record<string, string | string[]> | null;
  /** Validity start as a Node-formatted date string. */
  valid_from?: string;
  /** Validity end as a Node-formatted date string. */
  valid_to?: string;
  /** SHA-256 fingerprint, colon-delimited hex as Node emits it. */
  fingerprint256?: string;
  /** Certificate serial number as a hex string. */
  serialNumber?: string;
  /** Subject Alternative Names rendered as `DNS:a, IP Address:1.2.3.4, ...`. */
  subjectaltname?: string;
}

/**
 * Normalize a Node `getPeerCertificate(true)` result into a
 * {@link ClientCertificate}. Returns `undefined` for the empty object Node
 * returns when the peer presented no certificate.
 *
 * @param raw - The structured peer-certificate object from the TLS socket.
 * @param verified - Whether the socket reported `authorized === true` (the
 *   chain was verified against the configured CA).
 * @returns The normalized certificate, or `undefined` when `raw` is missing
 *   or carries no identifying fields (no subject, issuer, fingerprint, or
 *   serial).
 * @since 0.37.0
 */
export function normalizePeerCertificate(
  raw: PeerCertificateLike | null | undefined,
  verified: boolean
): ClientCertificate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const subjectDN = dnFromRecord(raw.subject);
  const issuerDN = dnFromRecord(raw.issuer);
  const hasAnyField =
    subjectDN !== undefined ||
    issuerDN !== undefined ||
    raw.fingerprint256 !== undefined ||
    raw.serialNumber !== undefined;
  if (!hasAnyField) return undefined;
  return {
    subjectDN,
    subjectCN: cnFromRecord(raw.subject),
    issuerDN,
    issuerCN: cnFromRecord(raw.issuer),
    serialNumber: raw.serialNumber,
    fingerprint256: normalizeFingerprint(raw.fingerprint256),
    subjectAltNames: parseNodeSubjectAltName(raw.subjectaltname),
    notBefore: parseCertDate(raw.valid_from),
    notAfter: parseCertDate(raw.valid_to),
    verified,
  };
}

function dnFromRecord(
  rec: Record<string, string | string[]> | null | undefined
): string | undefined {
  if (!rec || typeof rec !== "object") return undefined;
  const parts: string[] = [];
  for (const key of Object.keys(rec)) {
    const value = rec[key];
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${key}=${v}`);
    } else if (value !== undefined) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.length > 0 ? parts.join(",") : undefined;
}

function cnFromRecord(
  rec: Record<string, string | string[]> | null | undefined
): string | undefined {
  if (!rec || typeof rec !== "object") return undefined;
  const cn = rec["CN"];
  if (Array.isArray(cn)) return cn[0];
  return cn;
}

function normalizeFingerprint(fp: string | undefined): string | undefined {
  if (typeof fp !== "string" || fp.length === 0) return undefined;
  // Strip colon separators and uppercase so XFCC `Hash=` (no separators) and
  // Node `fingerprint256` (colon-delimited) compare identically.
  let out = "";
  for (let i = 0; i < fp.length; i++) {
    const c = fp.charCodeAt(i);
    if (c === 58 /* ':' */ || c === 32 /* space */) continue;
    out += fp[i];
  }
  return out.toUpperCase();
}

function parseCertDate(value: string | undefined): Date | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

function parseNodeSubjectAltName(san: string | undefined): readonly string[] {
  if (typeof san !== "string" || san.length === 0) return [];
  // Node renders SANs as `DNS:a, IP Address:1.2.3.4, URI:spiffe://...`.
  const out: string[] = [];
  for (const piece of san.split(",")) {
    const trimmed = piece.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed.replace(/^IP Address:/i, "IP:"));
  }
  return out;
}

/**
 * Split a string on a single-character separator while ignoring separators that
 * appear inside double-quoted spans. No backtracking — single linear scan.
 *
 * @internal
 */
function splitRespectingQuotes(value: string, sep: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === sep && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function cnFromDN(dn: string | undefined): string | undefined {
  if (!dn) return undefined;
  for (const rdn of splitRespectingQuotes(dn, ",")) {
    const eq = rdn.indexOf("=");
    if (eq === -1) continue;
    const key = rdn.slice(0, eq).trim();
    if (key.toUpperCase() === "CN") return unquote(rdn.slice(eq + 1));
  }
  return undefined;
}

/**
 * Parse an Envoy `X-Forwarded-Client-Cert` (XFCC) header value into a
 * {@link ClientCertificate}. XFCC is a comma-separated list of proxy elements,
 * each a `;`-delimited set of `Key=Value` pairs (`Hash`, `Subject`, `URI`,
 * `DNS`, `Cert`, …). The **first** element is the client closest to the origin
 * and is the one returned. Because Envoy only emits XFCC for connections it
 * mutually authenticated, the result is marked `verified: true`.
 *
 * @param headerValue Raw XFCC header value; `null`/`undefined` are tolerated.
 * @returns The certificate parsed from the first XFCC element, or `undefined`
 *   for an empty or unparseable header. Only trust this header behind a proxy
 *   you control that strips client-supplied XFCC.
 * @since 0.37.0
 */
export function parseForwardedClientCert(
  headerValue: string | null | undefined
): ClientCertificate | undefined {
  if (typeof headerValue !== "string" || headerValue.trim().length === 0) {
    return undefined;
  }
  const firstElement = splitRespectingQuotes(headerValue, ",")[0];
  if (!firstElement || firstElement.trim().length === 0) return undefined;
  let subjectDN: string | undefined;
  let fingerprint256: string | undefined;
  let serialNumber: string | undefined;
  let pem: string | undefined;
  const sans: string[] = [];
  for (const pair of splitRespectingQuotes(firstElement, ";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = unquote(pair.slice(eq + 1));
    if (value.length === 0) continue;
    switch (key) {
      case "subject":
        subjectDN = value;
        break;
      case "hash":
        fingerprint256 = normalizeFingerprint(value);
        break;
      case "serial":
        serialNumber = value;
        break;
      case "dns":
        sans.push(`DNS:${value}`);
        break;
      case "uri":
        sans.push(`URI:${value}`);
        break;
      case "cert":
        pem = decodeURIComponentSafe(value);
        break;
      default:
        break;
    }
  }
  if (
    subjectDN === undefined &&
    fingerprint256 === undefined &&
    sans.length === 0 &&
    pem === undefined
  ) {
    return undefined;
  }
  return {
    subjectDN,
    subjectCN: cnFromDN(subjectDN),
    serialNumber,
    fingerprint256,
    subjectAltNames: sans,
    verified: true,
    pem,
  };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Configuration for reading a forwarded client certificate out of request
 * headers set by a trusted TLS-terminating proxy.
 *
 * @since 0.37.0
 */
export type ClientCertHeaderConfig =
  | {
      /** Envoy `X-Forwarded-Client-Cert` format. */
      readonly format: "xfcc";
      /** Header name. Default: `"x-forwarded-client-cert"`. */
      readonly name?: string;
    }
  | {
      /**
       * Operator-named structured headers (nginx `$ssl_client_*`, HAProxy,
       * Traefik). Each property is the header name carrying that field.
       */
      readonly format: "structured";
      /** Header carrying the subject DN (e.g. nginx `$ssl_client_s_dn`). */
      readonly subjectDN?: string;
      /** Header carrying the issuer DN (e.g. nginx `$ssl_client_i_dn`). */
      readonly issuerDN?: string;
      /** Header carrying the SHA-256 fingerprint (e.g. nginx `$ssl_client_fingerprint`). */
      readonly fingerprint?: string;
      /** Header carrying the serial number. */
      readonly serialNumber?: string;
      /** Header carrying a comma-separated SAN list. */
      readonly san?: string;
      /** Header carrying the verification result (e.g. nginx `$ssl_client_verify`). */
      readonly verify?: string;
      /**
       * Value of the `verify` header that means "chain verified". Default:
       * `"SUCCESS"` (nginx). Compared case-insensitively.
       */
      readonly verifySuccessValue?: string;
    };

/**
 * Options for {@link clientCertAuth}.
 *
 * @since 0.37.0
 */
export interface ClientCertAuthOptions {
  /**
   * Override how the certificate is sourced. Defaults to reading whatever the
   * adapter attached via {@link setClientCertificate} (native TLS), falling
   * back to {@link header} parsing when configured. Runs before body I/O.
   */
  resolve?: (ctx: PreBodyContext<any>) => ClientCertificate | undefined;
  /**
   * Read the certificate from a trusted-proxy header instead of (or in
   * addition to) the native adapter source. **Spoofable** unless the app is
   * only reachable through the terminating proxy — pair with a strict
   * `behindProxy` posture.
   */
  header?: ClientCertHeaderConfig;
  /**
   * Require the TLS terminator to have cryptographically verified the chain
   * (`cert.verified === true`). Default: `true`. Only disable when an upstream
   * component performs verification out of band.
   */
  requireVerified?: boolean;
  /** If set, the subject CN must exactly match one of these values. */
  allowSubjectCNs?: readonly string[];
  /** If set, the issuer CN must exactly match one of these values. */
  allowIssuerCNs?: readonly string[];
  /**
   * If set, the certificate's SHA-256 fingerprint must match one of these
   * (compared in constant time; colons/spaces and case are ignored).
   */
  allowFingerprints?: readonly string[];
  /**
   * If set, at least one Subject Alternative Name must match one of these.
   * Entries may be given as `TYPE:value` (e.g. `"URI:spiffe://acme/svc-a"`) or
   * as a bare value matched against any SAN's value part.
   */
  allowSANs?: readonly string[];
  /**
   * Reject certificates outside their `[notBefore, notAfter]` validity window
   * when those bounds are known. Default: `true`. (A verifying TLS terminator
   * already enforces this, but a header-forwarded cert may not have been
   * fully validated.)
   */
  checkValidity?: boolean;
  /**
   * Custom per-request check, run after all built-in checks pass. Returning
   * `false` rejects with `403`; `true`/`undefined` accepts. The context body is
   * unavailable because certificate authentication runs before body I/O.
   */
  verify?: (
    cert: ClientCertificate,
    ctx: PreBodyContext<any>
  ) => boolean | void | Promise<boolean | void>;
  /** Rejection message for the `403` responses. Default: `"Client certificate not permitted"`. */
  message?: string;
  /** `ctx.state` key the accepted certificate is stamped on. Default: `"clientCertificate"`. */
  stateKey?: string;
  /** @internal Injectable clock for validity-window tests. */
  now?: () => number;
}

const MISSING_CERT_BODY = JSON.stringify({
  type: "https://daloyjs.dev/errors/client-certificate-required",
  title: "Client certificate required",
  status: 401,
});

/**
 * Middleware enforcing mutual-TLS client-certificate authentication. Reads the
 * normalized {@link ClientCertificate} attached by the adapter (native TLS) or
 * parsed from a trusted-proxy header, enforces verification + optional
 * allow-lists + validity window + a custom hook, and stamps the accepted
 * certificate on `ctx.state` for downstream handlers.
 *
 * Rejection semantics:
 * - **No certificate presented** → `401` `application/problem+json` with
 *   `Cache-Control: no-store`.
 * - **Unverified / not allow-listed / expired / custom-rejected** → `403`
 *   {@link ForbiddenError} (never echoes certificate details).
 *
 * @example Native TLS (Node adapter terminates mTLS):
 * ```ts
 * app.use(clientCertAuth({
 *   allowIssuerCNs: ["acme-internal-ca"],
 *   allowSANs: ["URI:spiffe://acme/svc-a"],
 * }));
 * ```
 *
 * @example Behind an Envoy proxy forwarding XFCC:
 * ```ts
 * app.use(clientCertAuth({
 *   header: { format: "xfcc" },
 *   allowFingerprints: [process.env.PEER_FINGERPRINT!],
 * }));
 * ```
 *
 * @param opts - Verification, allow-list, header-source, and hook options.
 * @returns A {@link Hooks} bundle for `app.use(...)`.
 * @since 0.37.0
 */
export function clientCertAuth(opts: ClientCertAuthOptions = {}): Hooks {
  const requireVerified = opts.requireVerified !== false;
  const checkValidity = opts.checkValidity !== false;
  const message = opts.message ?? "Client certificate not permitted";
  const stateKey = opts.stateKey ?? "clientCertificate";
  const now = opts.now ?? Date.now;
  const allowFingerprints = (opts.allowFingerprints ?? []).map(
    (f) => normalizeFingerprint(f) ?? ""
  );
  const allowSubjectCNs = opts.allowSubjectCNs;
  const allowIssuerCNs = opts.allowIssuerCNs;
  const allowSANs = opts.allowSANs;
  const headerConfig = opts.header;
  if (headerConfig !== undefined) {
    assertHeaderConfig(headerConfig);
  }

  const resolve =
    opts.resolve ??
    ((ctx: PreBodyContext<any>) => {
      const native = getClientCertificate(ctx.request);
      if (native) return native;
      if (headerConfig) return certFromHeaders(ctx.request, headerConfig);
      return undefined;
    });

  const authHooks: Hooks = {
    async preBody(ctx) {
      const cert = resolve(ctx);
      if (!cert) {
        return new Response(MISSING_CERT_BODY, {
          status: 401,
          headers: {
            "content-type": "application/problem+json",
            "cache-control": "no-store",
          },
        });
      }
      if (requireVerified && !cert.verified) {
        throw new ForbiddenError(message);
      }
      if (checkValidity && !isWithinValidity(cert, now())) {
        throw new ForbiddenError(message);
      }
      if (allowSubjectCNs && !matchesAllowedCN(cert.subjectCN, allowSubjectCNs)) {
        throw new ForbiddenError(message);
      }
      if (allowIssuerCNs && !matchesAllowedCN(cert.issuerCN, allowIssuerCNs)) {
        throw new ForbiddenError(message);
      }
      if (allowFingerprints.length > 0 && !matchesFingerprint(cert, allowFingerprints)) {
        throw new ForbiddenError(message);
      }
      if (allowSANs && !matchesSAN(cert.subjectAltNames, allowSANs)) {
        throw new ForbiddenError(message);
      }
      if (opts.verify) {
        const ok = await opts.verify(cert, ctx);
        if (ok === false) throw new ForbiddenError(message);
      }
      (ctx.state as Record<string, unknown>)[stateKey] = cert;
      return undefined;
    },
  };
  // Same global symbol as middleware's AUTH_HOOK_MARKER (stamped inline to keep
  // the middleware module out of this bundle): lets the route-auth boot guard
  // recognize that a route declaring `auth:` is actually enforced here.
  (authHooks as Record<PropertyKey, unknown>)[Symbol.for("daloyjs.auth.hook")] = true;
  return authHooks;
}

function assertHeaderConfig(cfg: ClientCertHeaderConfig): void {
  if (cfg.format === "xfcc") return;
  if (cfg.format === "structured") {
    if (!cfg.subjectDN && !cfg.fingerprint && !cfg.san && !cfg.serialNumber && !cfg.issuerDN) {
      throw new Error(
        "clientCertAuth(): structured header config must name at least one of subjectDN/issuerDN/fingerprint/serialNumber/san."
      );
    }
    return;
  }
  throw new Error('clientCertAuth(): header.format must be "xfcc" or "structured".');
}

function certFromHeaders(
  request: Request,
  cfg: ClientCertHeaderConfig
): ClientCertificate | undefined {
  if (cfg.format === "xfcc") {
    const name = cfg.name ?? "x-forwarded-client-cert";
    return parseForwardedClientCert(request.headers.get(name));
  }
  const subjectDN = readHeader(request, cfg.subjectDN);
  const issuerDN = readHeader(request, cfg.issuerDN);
  const fingerprint = normalizeFingerprint(readHeader(request, cfg.fingerprint));
  const serialNumber = readHeader(request, cfg.serialNumber);
  const sanRaw = readHeader(request, cfg.san);
  const verifyRaw = cfg.verify ? readHeader(request, cfg.verify) : undefined;
  const successValue = (cfg.verifySuccessValue ?? "SUCCESS").toLowerCase();
  // Without a configured verification header there is no cryptographic proof
  // the terminator validated the chain. Default to unverified so
  // requireVerified (default true) rejects spoofed identity-only headers.
  // Operators that intentionally trust a proxy which only forwards identity
  // must set requireVerified: false (and keep a strict behindProxy posture).
  const verified =
    cfg.verify === undefined ? false : (verifyRaw ?? "").toLowerCase() === successValue;
  const sans: string[] = [];
  if (sanRaw) {
    for (const piece of sanRaw.split(",")) {
      const trimmed = piece.trim();
      if (trimmed.length > 0) sans.push(trimmed);
    }
  }
  if (
    subjectDN === undefined &&
    issuerDN === undefined &&
    fingerprint === undefined &&
    serialNumber === undefined &&
    sans.length === 0
  ) {
    return undefined;
  }
  return {
    subjectDN,
    subjectCN: cnFromDN(subjectDN),
    issuerDN,
    issuerCN: cnFromDN(issuerDN),
    serialNumber,
    fingerprint256: fingerprint,
    subjectAltNames: sans,
    verified,
  };
}

function readHeader(request: Request, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const value = request.headers.get(name);
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isWithinValidity(cert: ClientCertificate, nowMs: number): boolean {
  if (cert.notBefore && nowMs < cert.notBefore.getTime()) return false;
  if (cert.notAfter && nowMs > cert.notAfter.getTime()) return false;
  return true;
}

function matchesAllowedCN(cn: string | undefined, allowed: readonly string[]): boolean {
  if (!cn) return false;
  for (const a of allowed) {
    if (a === cn) return true;
  }
  return false;
}

function matchesFingerprint(cert: ClientCertificate, allowed: readonly string[]): boolean {
  const fp = cert.fingerprint256;
  if (!fp) return false;
  let matched = false;
  // Constant-time per comparison; do not early-return so we don't leak which
  // allow-list entry matched via timing.
  for (const a of allowed) {
    if (timingSafeEqual(fp, a)) matched = true;
  }
  return matched;
}

function matchesSAN(sans: readonly string[], allowed: readonly string[]): boolean {
  if (sans.length === 0) return false;
  for (const want of allowed) {
    for (const have of sans) {
      if (have === want) return true;
      // Allow matching a bare value against the `TYPE:value` form.
      const colon = have.indexOf(":");
      if (colon !== -1 && have.slice(colon + 1) === want) return true;
    }
  }
  return false;
}
