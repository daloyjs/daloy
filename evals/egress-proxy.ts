/**
 * Allowlisting HTTPS egress proxy for the eval sandbox. Runs in its own
 * container on both the internal eval network and the normal bridge; see
 * `startEgressProxy` in `evals/lib/docker-sandbox.ts`. Only `CONNECT <allowlisted-name>:443` is tunnelled,
 * and only to public addresses. Plain HTTP requests and everything else get
 * 403. Every decision is logged as one JSON line on stdout.
 *
 * Environment: `EGRESS_ALLOW` (allowlist, default Copilot's hosts),
 * `EGRESS_PORT` (default 3128), `EGRESS_BIND` (host name or address to
 * listen on, default `0.0.0.0`; the sandbox passes the proxy's alias on the
 * internal network so the default bridge cannot reach it).
 *
 * Tunnels close if the upstream does not connect within 15 s or if either
 * side is idle for 5 minutes, so a stuck upstream cannot pin sockets.
 */

import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import {
  DEFAULT_EGRESS_ALLOW,
  hostAllowed,
  isPublicAddress,
  parseAllowlist,
  parseAuthority,
} from "./lib/egress.ts";

const allow = parseAllowlist(process.env.EGRESS_ALLOW ?? DEFAULT_EGRESS_ALLOW.join(","));
const port = Number(process.env.EGRESS_PORT ?? 3128);
const CONNECT_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 5 * 60_000;

function log(event: "allow" | "deny", target: string, reason?: string): void {
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), event, target, ...(reason ? { reason } : {}) })}\n`,
  );
}

const server = createServer((req, res) => {
  log("deny", req.headers.host ?? req.url ?? "?", "plain HTTP is not allowed");
  res.writeHead(403, { "content-type": "text/plain" }).end("egress denied\n");
});

server.on("connect", (req, client, head) => {
  const target = req.url ?? "";
  const deny = (reason: string): void => {
    log("deny", target, reason);
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  };
  client.on("error", () => client.destroy());
  const auth = parseAuthority(target);
  if (!auth) return deny("malformed target");
  if (auth.port !== 443) return deny("only port 443 is allowed");
  if (!hostAllowed(auth.host, allow)) return deny("host not on the allowlist");
  // IPv4 first: the Docker bridge the proxy leaves through is IPv4-only, so a
  // host whose first answer is an AAAA record would otherwise fail to connect.
  lookup(auth.host, { order: "ipv4first" })
    .then(({ address }) => {
      if (!isPublicAddress(address)) return deny(`resolves to non-public ${address}`);
      const upstream = connect(auth.port, address, () => {
        log("allow", target);
        const close = (): void => {
          upstream.destroy();
          client.destroy();
        };
        // setTimeout(ms, cb) adds cb as a listener and keeps earlier ones:
        // drop the connect-timeout handler or an idle close would also log
        // a spurious "connect timed out" deny.
        upstream.removeAllListeners("timeout");
        upstream.setTimeout(IDLE_TIMEOUT_MS, close);
        // A CONNECT request's client is always a net.Socket.
        (client as Socket).setTimeout(IDLE_TIMEOUT_MS, close);
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.setTimeout(CONNECT_TIMEOUT_MS, () => {
        log("deny", target, "upstream connect timed out");
        upstream.destroy();
        client.destroy();
      });
      upstream.on("error", () => {
        client.destroy();
      });
      client.on("close", () => upstream.destroy());
    })
    .catch(() => deny("DNS lookup failed"));
});

const bind = process.env.EGRESS_BIND
  ? (await lookup(process.env.EGRESS_BIND)).address
  : "0.0.0.0";
server.listen(port, bind, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "listening", bind, port, allow })}\n`,
  );
});
