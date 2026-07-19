/**
 * `fetchGuard()` — SSRF-hardened wrapper around the global `fetch` for
 * outbound calls a handler makes on behalf of a user.
 *
 * The classic SSRF chain documented by the
 * [Aikido write-up](https://www.aikido.dev/blog/how-a-startups-cloud-got-taken-over-by-a-simple-form-that-sends-an-email)
 * starts with a handler that fetches a user-supplied URL (an email avatar,
 * a webhook target, an "import from URL" feature) and ends with the
 * attacker pivoting through the cloud metadata service
 * (`http://169.254.169.254/...` on AWS/Azure/DigitalOcean,
 * `http://100.100.100.200/...` on Alibaba, `http://192.0.0.192/...` on
 * Oracle Cloud) to steal short-lived IAM credentials.
 *
 * `fetchGuard()` rejects requests that resolve to any of the following
 * address ranges unless explicitly opted-in:
 *
 * - Loopback: `127.0.0.0/8`, `::1` (opt in: `allowLoopback`).
 * - RFC1918 private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
 *   (opt in: `allowPrivate`).
 * - Link-local **including every documented cloud metadata IP**:
 *   `169.254.0.0/16`, `fe80::/10` (opt in: `allowLinkLocal`).
 * - Unique-local IPv6: `fc00::/7` (opt in: `allowUniqueLocal`).
 *
 * Plus an always-deny floor that no flag can lift:
 *
 * - `0.0.0.0/8` (this-network), `100.64.0.0/10` (carrier-grade NAT — covers
 *   Alibaba `100.100.100.200`), `169.254.169.254/32` (AWS / Azure /
 *   DigitalOcean / GCP IMDS), `169.254.170.2/32` and `169.254.170.23/32`
 *   (AWS ECS task metadata / EKS Pod Identity), `192.0.0.0/24` (covers
 *   Oracle Cloud `192.0.0.192`), `192.0.2.0/24`, `198.18.0.0/15`,
 *   `198.51.100.0/24`, `203.0.113.0/24` (IANA-reserved), `224.0.0.0/4`
 *   (multicast), `240.0.0.0/4` (reserved), `255.255.255.255` (broadcast).
 * - IPv6: `::/128` (unspecified), `ff00::/8` (multicast),
 *   `fd00:ec2::254/128` (AWS IMDSv2 IPv6), IPv4-mapped
 *   `::ffff:0:0/96` is re-checked against the embedded IPv4 address.
 *
 * The floor also picks up any user-supplied `denyAddresses` — these win
 * over `allowAddresses` and over the soft-deny class flags, so an
 * operator-pinned internal range is never accidentally re-exposed by a
 * later `allowAddresses` carveout.
 *
 * Redirects are followed **manually** with re-validation at each hop so
 * an attacker cannot bypass the check via a `302 → http://169.254...`.
 * `non-http(s)` protocols (`file:`, `ftp:`, `gopher:`, `data:`) are
 * rejected before any network call.
 *
 * ## Residual DNS-rebinding (TOCTOU) caveat
 *
 * `fetchGuard()` resolves the hostname, validates every returned address
 * against the deny / allow set, and only then hands the original
 * `Request` to the underlying `fetch`. The underlying `fetch` performs
 * its **own** DNS lookup when it opens the socket. An attacker that
 * controls a TTL=0 record can return a public IP at validation time and
 * a `127.0.0.1` / `169.254.169.254` at connect time, slipping past the
 * library-level check. To close the window:
 *
 *  0. **Built-in, `http:` only** (default on Node):
 *     {@link FetchGuardOptions.pinDns} defaults to `true` on Node-like
 *     runtimes (and `false` elsewhere). On Node, `http:` requests are
 *     then dispatched through `node:http` with the socket pinned to the
 *     validated IP (and the original `Host` header preserved), so there
 *     is no connect-time re-resolution to rebind. Set `pinDns: false` to
 *     opt out. `https:` is not pinned by this knob — see its docs — so
 *     the items below still matter for TLS upstreams.
 *  1. **Operator-side** (recommended): block egress to RFC1918 /
 *     loopback / link-local at the VPC / firewall layer. This neutralises
 *     the rebinding even if the application is naïve.
 *  2. **Caller-side, Node only** (covers `https:` too): install `undici`
 *     and pass a custom `fetch` that wires a dispatcher with a pinned-IP
 *     `connect.lookup`, e.g.
 *     ```ts
 *     import { Agent, fetch as undiciFetch } from "undici";
 *     import * as dns from "node:dns/promises";
 *     const safeFetch = fetchGuard({
 *       fetch: async (input, init) => {
 *         const url = new URL(typeof input === "string" ? input : input.url);
 *         const { address, family } = await dns.lookup(url.hostname, { verbatim: true });
 *         const dispatcher = new Agent({
 *           connect: { lookup: (_h, _o, cb) => cb(null, address, family) },
 *         });
 *         return undiciFetch(input, { ...init, dispatcher });
 *       },
 *     });
 *     ```
 *     The pre-resolved IP is what the socket connects to; TLS SNI /
 *     cert validation still uses the original hostname.
 *
 * @since 0.34.0
 * @module
 */

import { compileCidrMatcher, matchesMatcher, parseIp } from "./ip-restriction.js";
import type { IpMatcher, ParsedIp } from "./ip-restriction.js";

/**
 * Reason an SSRF guard refused to dispatch a request. Surfaced on
 * {@link SsrfBlockedError.reason} so callers can branch in tests / logs.
 *
 * @since 0.34.0
 */
export type SsrfBlockReason =
  | "protocol-not-allowed"
  | "host-not-allowed"
  | "dns-resolution-failed"
  | "address-not-allowed"
  | "too-many-redirects"
  | "credentials-in-url"
  | "invalid-url";

/**
 * Thrown by {@link fetchGuard} when an outbound request is refused. Never
 * thrown for ordinary network failures — those bubble through unchanged
 * so retry logic can distinguish "we refused" from "the network is sad".
 *
 * @since 0.34.0
 */
export class SsrfBlockedError extends Error {
  /** The request URL (or redirect target) that was refused. */
  readonly url: string;
  /** Machine-readable {@link SsrfBlockReason} explaining the refusal. */
  readonly reason: SsrfBlockReason;
  /** The resolved IP that tripped the guard, when the block was address-based. */
  readonly address?: string;
  constructor(url: string, reason: SsrfBlockReason, address?: string) {
    const where = address ? ` -> ${address}` : "";
    super(`SSRF blocked: ${url}${where} (${reason})`);
    this.name = "SsrfBlockedError";
    this.url = url;
    this.reason = reason;
    if (address !== undefined) this.address = address;
  }
}

/**
 * Options for {@link fetchGuard}. All defaults bias toward the safe
 * posture: only public IPs reachable over `http:` / `https:` are allowed.
 *
 * @since 0.34.0
 */
export interface FetchGuardOptions {
  /**
   * URL schemes the guard will permit. Defaults to
   * `["http:", "https:"]`. Anything else (`file:`, `data:`, `ftp:`,
   * `gopher:`, `dict:`, `ldap:`) is rejected with
   * `protocol-not-allowed`.
   */
  allowProtocols?: readonly string[];
  /**
   * IP literals, IPv4/IPv6 addresses, or CIDR ranges that bypass the
   * deny defaults. Use this for an explicit allowlist of public
   * upstreams. Hostnames are matched case-insensitively against the
   * post-DNS address set — pass an IP / CIDR, not a domain name.
   *
   * @example `["198.51.100.42", "2001:db8::/32"]`
   */
  allowAddresses?: readonly string[];
  /**
   * Hostnames that bypass DNS-based checks entirely. Useful when the
   * caller already verified the target out of band (e.g. internal
   * services on a known DNS name). Compared case-insensitively against
   * the URL hostname.
   */
  allowHosts?: readonly string[];
  /**
   * Extra IP / CIDR matchers to deny on top of the default floor.
   * Always wins against `allowAddresses`.
   */
  denyAddresses?: readonly string[];
  /**
   * Allow loopback addresses (`127.0.0.0/8`, `::1`). Default `false`.
   * Enable only for local-dev fixtures.
   */
  allowLoopback?: boolean;
  /**
   * Allow RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`,
   * `192.168.0.0/16`). Default `false`.
   */
  allowPrivate?: boolean;
  /**
   * Allow link-local ranges (`169.254.0.0/16`, `fe80::/10`). Default
   * `false`. **Leaving this off blocks every documented cloud
   * metadata service IP** (AWS/Azure/DigitalOcean `169.254.169.254`,
   * GCP `metadata.google.internal`).
   */
  allowLinkLocal?: boolean;
  /**
   * Allow IPv6 unique-local addresses (`fc00::/7`). Default `false`.
   */
  allowUniqueLocal?: boolean;
  /**
   * Maximum number of redirects to follow with re-validation. Default
   * `5`. Set `0` to refuse all redirects (returns the 3xx response
   * directly).
   */
  maxRedirects?: number;
  /**
   * Underlying fetch implementation. Defaults to `globalThis.fetch`.
   * Useful for tests or for layering on top of an instrumented client.
   */
  fetch?: typeof fetch;
  /**
   * DNS resolver. Defaults to `node:dns/promises.lookup(host, { all: true })`.
   * Provide a custom resolver on non-Node runtimes (Workers, Deno
   * without `--allow-net`) or to enforce an in-memory test fixture.
   */
  resolve?: (hostname: string) => Promise<readonly string[]>;
  /**
   * Close the residual DNS-rebinding (TOCTOU) window for **`http:`** requests
   * by connecting the socket to the exact IP that was validated, instead of
   * letting the underlying client re-resolve the hostname at connect time.
   *
   * When `true`, a request to a hostname that resolves to a validated address
   * is dispatched through Node's built-in `node:http` with the connection
   * pinned to that address and the original `Host` header preserved — so
   * virtual-host routing still works while an attacker's TTL=0 rebinding to
   * `127.0.0.1` / `169.254.169.254` can no longer take effect between
   * validation and connect.
   *
   * **Default:** `true` on Node-like runtimes (`process.versions.node` is a
   * non-empty string), `false` elsewhere (Workers / edge sandboxes without
   * `node:http`). Pass `pinDns: false` to opt out on Node, or `pinDns: true`
   * on a non-Node runtime only if you can tolerate the loud error when the
   * pin path cannot load `node:http`.
   *
   * **Scope and caveats** (read before changing the default):
   *
   * - **`http:` only.** `https:` is intentionally NOT pinned here: pinning a
   *   TLS connection to an IP while keeping hostname-based SNI / certificate
   *   validation needs more machinery than this knob provides, so `https:`
   *   requests fall through to the normal validated-then-fetch path and retain
   *   the documented TOCTOU caveat. The prime rebinding target — cloud
   *   metadata at `http://169.254.169.254` — is `http:`, so this still closes
   *   the highest-value vector.
   * - **Node only for the pin path.** It uses `node:http`; when `pinDns` is
   *   explicitly `true` on a runtime without it, an `http:` pinned dispatch
   *   throws a clear error so the misconfiguration is loud rather than a
   *   silent no-op.
   * - **Bypasses `options.fetch`** for the pinned `http:` path (it must own the
   *   socket), and negotiates no response compression (`Accept-Encoding:
   *   identity`) so body semantics match a plain `fetch`.
   *
   * Requests to a literal-IP host or an `allowHosts` entry are never pinned
   * (the former already connects to an exact IP; the latter is an explicit
   * operator trust).
   *
   * @since 0.44.0
   */
  pinDns?: boolean;
}

/**
 * Whether this runtime looks like Node (or a Node-compatible host such as Bun)
 * where `node:http` DNS pinning is available.
 *
 * Used as the default for {@link FetchGuardOptions.pinDns} so Node apps get
 * rebinding defense without an opt-in, while Workers / pure edge runtimes keep
 * the non-pinning path.
 */
function defaultPinDnsEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    process.versions != null &&
    typeof process.versions.node === "string" &&
    process.versions.node.length > 0
  );
}

// Always-on deny matchers. No option flips these.
const ALWAYS_DENY: readonly string[] = [
  "0.0.0.0/8", // "this network"
  "100.64.0.0/10", // CGNAT (Alibaba metadata 100.100.100.200)
  "169.254.169.254/32", // AWS / Azure / DigitalOcean / GCP IMDS — hard floor
  "169.254.170.2/32", // AWS ECS task metadata v2 / EKS Pod Identity
  "169.254.170.23/32", // AWS EKS Pod Identity (IPv4)
  "192.0.0.0/24", // IANA reserved (Oracle metadata 192.0.0.192)
  "192.0.2.0/24", // TEST-NET-1
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved (includes 255.255.255.255)
  "::/128", // unspecified
  "ff00::/8", // IPv6 multicast
  "fd00:ec2::254/128", // AWS IMDSv2 IPv6
];

const LOOPBACK = ["127.0.0.0/8", "::1/128"];
const LINK_LOCAL = ["169.254.0.0/16", "fe80::/10"];
const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
const UNIQUE_LOCAL = ["fc00::/7"];

/**
 * Wrap `fetch` with an SSRF-hardened guard. The returned function has
 * the same call signature as the global `fetch` and throws
 * {@link SsrfBlockedError} when an outbound request would target a
 * dangerous internal address.
 *
 * @example
 * ```ts
 * import { fetchGuard } from "@daloyjs/core";
 *
 * const safeFetch = fetchGuard();
 *
 * app.route({
 *   method: "POST", path: "/import", operationId: "import",
 *   request: { json: z.object({ url: z.string().url() }) },
 *   responses: { 200: { description: "ok" } },
 *   handler: async ({ request }) => {
 *     const { url } = await request.json();
 *     const upstream = await safeFetch(url); // refuses 169.254.169.254
 *     return { status: 200 as const, body: await upstream.text() };
 *   },
 * });
 * ```
 *
 * @param options - Guard configuration; see {@link FetchGuardOptions}. Omit
 *   for the strict default posture (public IPs over `http:`/`https:` only).
 * @returns A `fetch`-compatible function that validates every hop (including
 *   redirects) and throws {@link SsrfBlockedError} on refusal.
 * @since 0.34.0
 */
export function fetchGuard(options: FetchGuardOptions = {}): typeof fetch {
  const allowProtocols = new Set(
    (options.allowProtocols ?? ["http:", "https:"]).map((s) => s.toLowerCase()),
  );
  // Hard-deny floor: ALWAYS_DENY (cloud metadata + reserved) plus any
  // user-supplied `denyAddresses`. No allow flag, including
  // `allowAddresses`, can lift these — this is what keeps a misconfigured
  // egress allow-list from accidentally re-exposing 169.254.169.254 or
  // an operator-pinned internal range.
  const hardDenyMatchers: IpMatcher[] = [];
  // Soft-deny class defaults: loopback / private / link-local /
  // unique-local. These reflect "off by default" classes that the
  // matching `allow*` flag — or an explicit `allowAddresses` range —
  // is allowed to opt into.
  const softDenyMatchers: IpMatcher[] = [];
  const allowMatchers: IpMatcher[] = [];
  const allowHosts = new Set((options.allowHosts ?? []).map((h) => h.toLowerCase()));
  const maxRedirects = options.maxRedirects ?? 5;
  const baseFetch = options.fetch ?? (globalThis.fetch as typeof fetch);
  if (typeof baseFetch !== "function") {
    throw new Error("fetchGuard(): no global fetch available; pass options.fetch.");
  }
  const resolveFn = options.resolve ?? createDefaultResolver();
  // Secure default on Node when using the built-in fetch: pin http: sockets
  // to the validated IP. A custom `options.fetch` owns its own socket / DNS
  // policy, so pinDns stays off unless the caller opts in. Non-Node runtimes
  // default off (no node:http). Opt out on Node with `pinDns: false`.
  const pinDns =
    options.pinDns ?? (options.fetch === undefined && defaultPinDnsEnabled());

  for (const c of ALWAYS_DENY) hardDenyMatchers.push(compileCidrMatcher(c));
  for (const c of options.denyAddresses ?? []) hardDenyMatchers.push(compileCidrMatcher(c));
  if (!options.allowLoopback) {
    for (const c of LOOPBACK) softDenyMatchers.push(compileCidrMatcher(c));
  }
  if (!options.allowPrivate) {
    for (const c of PRIVATE) softDenyMatchers.push(compileCidrMatcher(c));
  }
  if (!options.allowLinkLocal) {
    for (const c of LINK_LOCAL) softDenyMatchers.push(compileCidrMatcher(c));
  }
  if (!options.allowUniqueLocal) {
    for (const c of UNIQUE_LOCAL) softDenyMatchers.push(compileCidrMatcher(c));
  }
  for (const c of options.allowAddresses ?? []) allowMatchers.push(compileCidrMatcher(c));

  function isAddressAllowed(parsed: ParsedIp): boolean {
    // Hard-deny wins over every allow knob — cloud metadata IPs and
    // operator-pinned `denyAddresses` are non-negotiable.
    if (hardDenyMatchers.some((m) => matchesMatcher(parsed, m))) return false;
    if (allowMatchers.some((m) => matchesMatcher(parsed, m))) return true;
    return !softDenyMatchers.some((m) => matchesMatcher(parsed, m));
  }

  /**
   * Validate a URL's destination against the deny/allow policy.
   *
   * @returns the single validated IP the connection should be **pinned** to
   *   (the first resolved address), or `null` when pinning does not apply —
   *   the host is an `allowHosts` entry (explicit operator trust) or already a
   *   literal IP (the socket connects to that exact address, so there is no
   *   re-resolution window to close).
   * @throws {SsrfBlockedError} when the protocol, host, or any resolved
   *   address is not permitted.
   */
  async function validateUrl(url: URL): Promise<string | null> {
    const proto = url.protocol.toLowerCase();
    if (!allowProtocols.has(proto)) {
      throw new SsrfBlockedError(url.toString(), "protocol-not-allowed");
    }
    // URL.hostname strips brackets from IPv6 literals — perfect for parseIp.
    const hostname = url.hostname;
    if (!hostname) {
      throw new SsrfBlockedError(url.toString(), "invalid-url");
    }
    if (allowHosts.has(hostname.toLowerCase())) return null;
    const literal = parseIp(hostname);
    if (literal) {
      if (!isAddressAllowed(literal)) {
        throw new SsrfBlockedError(url.toString(), "address-not-allowed", hostname);
      }
      return null;
    }
    let addrs: readonly string[];
    try {
      addrs = await resolveFn(hostname);
    } catch {
      throw new SsrfBlockedError(url.toString(), "dns-resolution-failed", hostname);
    }
    if (!addrs.length) {
      throw new SsrfBlockedError(url.toString(), "dns-resolution-failed", hostname);
    }
    for (const a of addrs) {
      const p = parseIp(a);
      if (!p) {
        throw new SsrfBlockedError(url.toString(), "dns-resolution-failed", a);
      }
      if (!isAddressAllowed(p)) {
        throw new SsrfBlockedError(url.toString(), "address-not-allowed", a);
      }
    }
    return addrs[0]!;
  }

  const guarded: typeof fetch = async (input, init) => {
    // A URL carrying userinfo (`http://user:pass@internal/`) is a classic SSRF
    // obfuscation — the real host hides after the `@`. undici's `Request`
    // constructor refuses such URLs with a raw `TypeError`, which would fire
    // *before* our host validation and escape the `SsrfBlockedError` contract,
    // so callers misclassify a blocked SSRF attempt as an ordinary upstream
    // failure. Detect and refuse it ourselves with a typed error first. The
    // credentials are stripped from the URL recorded on the error so a
    // caller-supplied secret never leaks into logs. Malformed URLs fall
    // through to the handling below, which raises `SsrfBlockedError("invalid-url")`.
    if (typeof input === "string" || input instanceof URL) {
      let pre: URL | undefined;
      try {
        pre = new URL(input as string | URL);
      } catch {
        pre = undefined;
      }
      if (pre && (pre.username !== "" || pre.password !== "")) {
        pre.username = "";
        pre.password = "";
        throw new SsrfBlockedError(pre.toString(), "credentials-in-url");
      }
    }
    let request = new Request(input as RequestInfo, init);
    const userRedirect = (init?.redirect ?? request.redirect) as RequestRedirect;
    // Always dispatch underlying calls with redirect: "manual" so we can
    // re-validate each Location ourselves.
    let currentUrl: URL;
    try {
      currentUrl = new URL(request.url);
    } catch {
      throw new SsrfBlockedError(String(input), "invalid-url");
    }
    for (let hop = 0; ; hop++) {
      const pinnedIp = await validateUrl(currentUrl);
      const dispatchInit: RequestInit = { redirect: "manual" };
      const dispatchReq = new Request(request, dispatchInit);
      // When DNS pinning is enabled, dispatch `http:` requests through a
      // socket bound to the exact validated IP so the underlying client cannot
      // re-resolve the hostname to an internal address between validation and
      // connect (DNS-rebinding TOCTOU). `https:` keeps the normal path — see
      // the `pinDns` option docs for why.
      const res =
        pinDns && pinnedIp !== null && currentUrl.protocol === "http:"
          ? await pinnedHttpFetch(dispatchReq, pinnedIp)
          : await baseFetch(dispatchReq);
      if (!isRedirect(res.status)) return res;
      if (userRedirect === "error") {
        throw new TypeError("fetchGuard: redirect refused (redirect: error)");
      }
      if (userRedirect === "manual" || maxRedirects === 0) return res;
      if (hop >= maxRedirects) {
        throw new SsrfBlockedError(currentUrl.toString(), "too-many-redirects");
      }
      const loc = res.headers.get("location");
      if (!loc) return res;
      let next: URL;
      try {
        next = new URL(loc, currentUrl);
      } catch {
        throw new SsrfBlockedError(loc, "invalid-url");
      }
      // Per fetch spec: 303 (and 301/302 for non-GET/HEAD in practice) downgrade to GET.
      const method = request.method.toUpperCase();
      const shouldDowngrade =
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD");
      // Committed to following this hop. Drain the intermediate 3xx body so
      // the underlying socket isn't pinned until GC (Node/undici keep the
      // connection open while an un-consumed body stream is outstanding).
      void res.body?.cancel();
      request = shouldDowngrade
        ? new Request(next, {
            method: "GET",
            headers: stripBodyHeaders(request.headers),
            redirect: "manual",
            credentials: request.credentials,
            referrerPolicy: request.referrerPolicy,
          })
        : new Request(next, request);
      currentUrl = next;
    }
  };
  return guarded;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Dispatch an `http:` request with the TCP connection **pinned** to a single,
 * already-validated IP address — closing the DNS-rebinding (TOCTOU) window that
 * exists when the underlying `fetch` re-resolves the hostname at connect time.
 *
 * Uses Node's built-in `node:http` (no runtime dependency) so the `Host` header
 * can be set to the original authority — preserving virtual-host routing while
 * the socket targets `ip`, never a re-resolved address. The response body is
 * streamed (not buffered) so large downloads keep the same memory profile as a
 * plain `fetch`. `Accept-Encoding: identity` is forced so the returned body is
 * not silently left compressed (Node's `http` does not auto-decode).
 *
 * @param req - The request to dispatch (its URL supplies the path + `Host`).
 * @param ip - The validated address to connect to.
 * @returns A web {@link Response} mirroring the upstream reply.
 * @throws when `node:http` is unavailable (non-Node runtime) or the socket errors.
 */
async function pinnedHttpFetch(req: Request, ip: string): Promise<Response> {
  let httpRequest: typeof import("node:http").request;
  let toWeb: typeof import("node:stream").Readable.toWeb;
  try {
    ({ request: httpRequest } = await import("node:http"));
    ({ toWeb } = (await import("node:stream")).Readable);
  } catch {
    throw new Error(
      "fetchGuard({ pinDns: true }): node:http is unavailable on this runtime; " +
        "DNS pinning for http: requires Node. Disable pinDns or run on Node.",
    );
  }
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  // Preserve the original authority so virtual-host routing still works even
  // though the socket connects to a raw IP.
  headers["host"] = url.host;
  // Do not negotiate compression: node:http won't auto-decode it, and a
  // silently-compressed body would break `res.text()` / `res.json()` callers.
  headers["accept-encoding"] = "identity";
  const method = req.method.toUpperCase();
  const bodyBytes =
    method === "GET" || method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());

  return await new Promise<Response>((resolve, reject) => {
    const clientReq = httpRequest(
      {
        host: ip,
        port: url.port ? Number(url.port) : 80,
        method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (res) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) {
            for (const v of value) responseHeaders.append(key, v);
          } else if (typeof value === "string") {
            responseHeaders.set(key, value);
          }
        }
        const status = res.statusCode ?? 502;
        // 204/304 and HEAD responses must carry a null body per the spec.
        const nullBody = status === 204 || status === 304 || method === "HEAD";
        if (nullBody) {
          res.resume(); // drain so the socket can be released
          resolve(new Response(null, { status, statusText: res.statusMessage, headers: responseHeaders }));
          return;
        }
        resolve(
          new Response(toWeb(res) as unknown as ReadableStream, {
            status,
            statusText: res.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );
    clientReq.on("error", reject);
    if (bodyBytes && bodyBytes.byteLength > 0) clientReq.write(bodyBytes);
    clientReq.end();
  });
}

function stripBodyHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete("content-length");
  out.delete("content-type");
  out.delete("content-encoding");
  out.delete("content-language");
  out.delete("content-location");
  return out;
}

function createDefaultResolver(): (host: string) => Promise<readonly string[]> {
  let lookupPromise: Promise<((h: string, opts: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>) | null> | null = null;
  return async (host) => {
    if (!lookupPromise) {
      lookupPromise = import("node:dns/promises")
        .then((m) => m.lookup as unknown as (h: string, opts: { all: true; verbatim: true }) => Promise<Array<{ address: string }>>)
        .catch(() => null);
    }
    const lookup = await lookupPromise;
    if (!lookup) {
      throw new Error(
        "fetchGuard: no DNS resolver available on this runtime. Pass options.resolve.",
      );
    }
    const results = await lookup(host, { all: true, verbatim: true });
    return results.map((r) => r.address);
  };
}
