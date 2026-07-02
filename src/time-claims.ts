/**
 * Single source of truth for time-based JWT-style claim validation.
 *
 * Every first-party verifier — `createJwtVerifier()`, `jwk()`, and any future
 * session-token verifier — MUST route through {@link assertTemporalClaims}
 * so the framework has exactly one implementation of:
 *
 *  - the `exp` (expiration) check;
 *  - the `nbf` (not-before) check;
 *  - the `iat` (issued-at) future-clock-skew refusal;
 *  - the clock-skew tolerance shape (a non-negative number of seconds,
 *    applied symmetrically to all three claims).
 *
 * Centralizing the check means a developer that ships a custom JWT-shaped
 * token verifier inside their app reaches for the same helper instead of
 * re-implementing the comparison (and getting the inequality sign wrong on
 * `iat`).
 *
 * @since 0.27.0
 */

/**
 * Error thrown by {@link assertTemporalClaims}. The `code` is machine
 * readable so callers can map specific failures to RFC-6750-style
 * `WWW-Authenticate` challenges without parsing the message.
 *
 * @since 0.27.0
 */
export class TemporalClaimError extends Error {
  /** Machine-readable failure code identifying which claim check failed. */
  readonly code: TemporalClaimErrorCode;
  constructor(code: TemporalClaimErrorCode, message: string) {
    super(message);
    this.name = "TemporalClaimError";
    this.code = code;
  }
}

/**
 * Failure codes for {@link TemporalClaimError}. `invalid_*` codes mean the
 * claim (or option) was present but not a finite number; the remaining codes
 * mean a well-formed claim failed its RFC 7519 time comparison.
 *
 * @since 0.27.0
 */
export type TemporalClaimErrorCode =
  | "invalid_exp"
  | "token_expired"
  | "invalid_nbf"
  | "token_not_yet_valid"
  | "invalid_iat"
  | "iat_in_future"
  | "invalid_clock_skew";

/**
 * Subset of a JWT-style payload that participates in temporal validation.
 * All three claims are optional — the verifier only enforces what is
 * present.
 *
 * @since 0.27.0
 */
export interface TemporalClaims {
  /** Expiration time (RFC 7519 `exp`), unix seconds. Validated when present. */
  readonly exp?: unknown;
  /** Not-before time (RFC 7519 `nbf`), unix seconds. Validated when present. */
  readonly nbf?: unknown;
  /** Issued-at time (RFC 7519 `iat`), unix seconds. Rejected if in the future. */
  readonly iat?: unknown;
}

/**
 * Options for {@link assertTemporalClaims}: the reference clock and the
 * symmetric clock-skew tolerance.
 *
 * @since 0.27.0
 */
export interface AssertTemporalClaimsOptions {
  /** Current unix-seconds timestamp. Injectable for tests. */
  readonly now: number;
  /**
   * Symmetric clock-skew tolerance applied to `exp` / `nbf` / `iat`. Default
   * `0` — the verifier refuses tokens with no skew tolerance.
   */
  readonly clockSkewSeconds?: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate the temporal claims (`exp`, `nbf`, `iat`) on a JWT-style
 * payload. Throws {@link TemporalClaimError} on the first violation;
 * returns normally when every present claim passes.
 *
 * Inequalities follow RFC 7519:
 *
 *  - `exp` rejected when `now > exp + skew` (the token has expired);
 *  - `nbf` rejected when `now + skew < nbf` (not yet valid);
 *  - `iat` rejected when `iat - skew > now` (issued in the future — the
 *    issuer's clock is wrong, or someone pre-issued a token).
 *
 * @param claims Decoded payload; only the claims that are present are checked.
 * @param opts Reference clock (`now`, unix seconds) and optional
 *   `clockSkewSeconds` tolerance (defaults to `0`).
 * @throws TemporalClaimError on the first failing check, including malformed
 *   (non-finite) claim values or an invalid `now` / negative skew.
 * @since 0.27.0
 */
export function assertTemporalClaims(
  claims: TemporalClaims,
  opts: AssertTemporalClaimsOptions,
): void {
  const skew = opts.clockSkewSeconds ?? 0;
  if (!isFiniteNumber(skew) || skew < 0) {
    throw new TemporalClaimError(
      "invalid_clock_skew",
      "clockSkewSeconds must be a non-negative finite number.",
    );
  }
  const now = opts.now;
  if (!isFiniteNumber(now)) {
    throw new TemporalClaimError(
      "invalid_clock_skew",
      "now must be a finite number of unix seconds.",
    );
  }
  if (claims.exp !== undefined) {
    if (!isFiniteNumber(claims.exp)) {
      throw new TemporalClaimError("invalid_exp", "payload.exp is not a finite number.");
    }
    if (now > claims.exp + skew) {
      throw new TemporalClaimError("token_expired", "token has expired (exp).");
    }
  }
  if (claims.nbf !== undefined) {
    if (!isFiniteNumber(claims.nbf)) {
      throw new TemporalClaimError("invalid_nbf", "payload.nbf is not a finite number.");
    }
    if (now + skew < claims.nbf) {
      throw new TemporalClaimError("token_not_yet_valid", "token is not yet valid (nbf).");
    }
  }
  if (claims.iat !== undefined) {
    if (!isFiniteNumber(claims.iat)) {
      throw new TemporalClaimError("invalid_iat", "payload.iat is not a finite number.");
    }
    if (claims.iat - skew > now) {
      throw new TemporalClaimError("iat_in_future", "payload.iat is in the future.");
    }
  }
}
