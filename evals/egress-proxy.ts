/**
 * Allowlisting HTTPS egress proxy for the eval sandbox. Runs in its own
 * container on both the internal eval network and the normal bridge; see
 * `evals/sandbox-run.sh`. Only `CONNECT <allowlisted-name>:443` is tunnelled,
 * and only to public addresses. Plain HTTP requests and everything else get
 * 403. Every decision is logged as one JSON line on stdout.
 *
 * Environment: `EGRESS_ALLOW` (allowlist, default Copilot's hosts),
 * `EGRESS_PORT` (default 3128).
 */

import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import {
  DEFAULT_EGRESS_ALLOW,
  hostAllowed,
  isPublicAddress,
  parseAllowlist,
  parseAuthority,
} from "./lib/egress.ts";

const allow = parseAllowlist(process.env.EGRESS_ALLOW ?? DEFAULT_EGRESS_ALLOW.join(","));
const port = Number(process.env.EGRESS_PORT ?? 3128);

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
  lookup(auth.host)
    .then(({ address }) => {
      if (!isPublicAddress(address)) return deny(`resolves to non-public ${address}`);
      const upstream = connect(auth.port, address, () => {
        log("allow", target);
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on("error", () => {
        client.destroy();
      });
      client.on("close", () => upstream.destroy());
    })
    .catch(() => deny("DNS lookup failed"));
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({ event: "listening", port, allow })}\n`,
  );
});
