/**
 * Password hashing helpers with no knobs.
 *
 * Daloy's secure-by-default initiative ships exactly one correct way to
 * hash a password. There is no algorithm switch, no cost-factor argument,
 * no salt management — the API is two functions: {@link passwordHash} and
 * {@link passwordVerify}.
 *
 * The implementation uses Node's built-in `crypto.scrypt` with parameters
 * aligned with the OWASP Password Storage Cheat Sheet for scrypt
 * (`N = 2^17`, `r = 8`, `p = 1`, 32-byte key, 16-byte salt). scrypt is
 * memory-hard like Argon2 and ships in Node core, so this helper has no
 * runtime dependencies. The output is a self-describing PHC-style string
 * — verifying a hash never requires re-supplying the parameters.
 *
 * Argon2id is the preferred OWASP recommendation but requires a native
 * binding that Daloy explicitly refuses to ship in `dependencies`. Apps
 * that need Argon2id should pull `argon2` themselves; this helper
 * intentionally uses scrypt to keep the install surface zero.
 *
 * Subpath: `@daloyjs/core/hashing`.
 *
 * @since 0.15.0
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

// OWASP-aligned scrypt parameters (Password Storage Cheat Sheet, 2024).
const SCRYPT_N = 1 << 17; // 131072
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALTLEN = 16;
// Generous max — covers OWASP's recommended `N = 2^17` at `r = 8`, `p = 1`.
const SCRYPT_MAXMEM = 192 * 1024 * 1024;

function scryptAsync(password: Buffer, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      password,
      salt,
      keylen,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

function toBase64(b: Buffer): string {
  return b.toString("base64").replace(/=+$/, "");
}

function fromBase64(s: string): Buffer | null {
  if (s.length === 0 || s.length % 4 === 1) return null;
  if (!/^[A-Za-z0-9+/]+$/.test(s)) return null;
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    return Buffer.from(s + pad, "base64");
  } catch {
    return null;
  }
}

/**
 * Hash a password and return a self-describing PHC-style string. The
 * returned string encodes the algorithm, parameters, salt, and digest so
 * {@link passwordVerify} needs nothing else.
 *
 * Format: `$scrypt$N=131072,r=8,p=1$<salt-base64>$<hash-base64>`
 *
 * @example
 * ```ts
 * import { passwordHash, passwordVerify } from "@daloyjs/core/hashing";
 *
 * const hash = await passwordHash("hunter2");
 * await passwordVerify("hunter2", hash); // true
 * await passwordVerify("wrong", hash);   // false
 * ```
 *
 * @param password - The plaintext password. UTF-8 encoded internally.
 * @returns A PHC-style hash string safe to store in a database column.
 * @throws {TypeError} When `password` is empty.
 * @since 0.15.0
 */
export async function passwordHash(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("password must be a non-empty string");
  }
  const salt = randomBytes(SCRYPT_SALTLEN);
  const key = await scryptAsync(Buffer.from(password, "utf8"), salt, SCRYPT_KEYLEN);
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${toBase64(salt)}$${toBase64(key)}`;
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parsePhc(s: string): ParsedHash | null {
  // $scrypt$N=...,r=...,p=...$salt$hash
  if (typeof s !== "string" || s.length < 32) return null;
  const parts = s.split("$");
  if (parts.length !== 5) return null;
  if (parts[0] !== "" || parts[1] !== "scrypt") return null;
  const paramSection = parts[2] ?? "";
  const paramMatch = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(paramSection);
  if (!paramMatch) return null;
  const N = Number(paramMatch[1]);
  const r = Number(paramMatch[2]);
  const p = Number(paramMatch[3]);
  if (!Number.isInteger(N) || N <= 1 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1) return null;
  if (!Number.isInteger(p) || p < 1) return null;
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return null;
  const salt = fromBase64(parts[3] ?? "");
  const hash = fromBase64(parts[4] ?? "");
  if (!salt || !hash || salt.length !== SCRYPT_SALTLEN || hash.length !== SCRYPT_KEYLEN) return null;
  return { N, r, p, salt, hash };
}

/**
 * Verify a plaintext password against a PHC-style hash produced by
 * {@link passwordHash} in constant time. Returns `false` (never throws)
 * for any malformed input so the caller cannot distinguish "bad hash
 * format" from "wrong password" through exception side channels.
 *
 * @param password - The plaintext password to check.
 * @param storedHash - The PHC-style hash returned from {@link passwordHash}.
 * @returns `true` when the password matches, `false` otherwise.
 * @since 0.15.0
 */
export async function passwordVerify(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const parsed = parsePhc(storedHash);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = await new Promise<Buffer>((resolve, reject) => {
      scryptCb(
        Buffer.from(password, "utf8"),
        parsed.salt,
        parsed.hash.length,
        { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM },
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        },
      );
    });
  } catch {
    return false;
  }
  if (derived.length !== parsed.hash.length) return false;
  return nodeTimingSafeEqual(derived, parsed.hash);
}
