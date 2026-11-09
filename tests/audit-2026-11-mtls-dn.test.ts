/**
 * Audit 2026-11: header-forwarded subject/issuer DNs are parsed per RFC 4514.
 *
 * A trusted CA that copies a requested OU into the subject can issue a cert
 * whose RFC 2253 form is `OU=x\,CN=admin,...`. The old parser ignored the
 * backslash escape (and XFCC unquoting dropped it), so `CN=admin` was read as
 * the CN and passed `allowSubjectCNs: ["admin"]`. The fix keeps escapes intact,
 * splits RDNs/AVAs only on unescaped separators, and fails closed on
 * malformed or multi-CN DNs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  clientCertAuth,
  parseForwardedClientCert,
  setClientCertificate,
  type ClientCertificate,
} from "../src/index.js";

const NO_CN = "OU=x\\,CN=admin,O=acme";
const REAL_CN_AFTER = "OU=x\\,CN=admin,CN=attacker";

function app(opts: Parameters<typeof clientCertAuth>[0]): App {
  const a = new App({ env: "development" });
  a.use(clientCertAuth(opts));
  a.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: {
        cn:
          (ctx.state as Record<string, ClientCertificate>).clientCertificate?.subjectCN ??
          null,
      },
    }),
  });
  return a;
}

const structured = (allow: Partial<Parameters<typeof clientCertAuth>[0] & object> = {}) =>
  app({
    header: {
      format: "structured",
      subjectDN: "x-ssl-client-s-dn",
      issuerDN: "x-ssl-client-i-dn",
      verify: "x-ssl-client-verify",
    },
    allowSubjectCNs: ["admin"],
    ...allow,
  });
const xfcc = () => app({ header: { format: "xfcc" }, allowSubjectCNs: ["admin"] });

function sReq(subject: string, issuer?: string): Request {
  const headers: Record<string, string> = {
    "x-ssl-client-s-dn": subject,
    "x-ssl-client-verify": "SUCCESS",
  };
  if (issuer !== undefined) headers["x-ssl-client-i-dn"] = issuer;
  return new Request("http://x/", { headers });
}
const xReq = (subject: string) =>
  new Request("http://x/", {
    headers: { "x-forwarded-client-cert": `Hash=ab;Subject="${subject}"` },
  });

test("structured mode: an escaped comma in OU cannot smuggle a CN past allowSubjectCNs", async () => {
  assert.equal((await structured().fetch(sReq(NO_CN))).status, 403);
  assert.equal((await structured().fetch(sReq(REAL_CN_AFTER))).status, 403);
  // Happy: a genuine CN=admin still passes.
  const ok = await structured().fetch(sReq("CN=admin,O=acme"));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { cn: "admin" });
});

test("xfcc mode: Subject keeps RFC 4514 escapes so the smuggled CN is rejected", async () => {
  assert.equal((await xfcc().fetch(xReq(NO_CN))).status, 403);
  assert.equal((await xfcc().fetch(xReq(REAL_CN_AFTER))).status, 403);
  const ok = await xfcc().fetch(xReq("CN=admin,O=acme"));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { cn: "admin" });
});

test("parseForwardedClientCert exposes the escaped DN and the real CN", () => {
  const noCn = parseForwardedClientCert(`Hash=ab;Subject="${NO_CN}"`);
  assert.equal(noCn?.subjectDN, NO_CN);
  assert.equal(noCn?.subjectCN, undefined);
  const real = parseForwardedClientCert(`Hash=ab;Subject="${REAL_CN_AFTER}"`);
  assert.equal(real?.subjectDN, REAL_CN_AFTER);
  assert.equal(real?.subjectCN, "attacker");
  // XFCC-level \" escapes are still resolved (quoted DN value).
  assert.equal(
    parseForwardedClientCert('Hash=ab;Subject="CN=\\"Ops, Inc.\\",O=Acme"')?.subjectCN,
    "Ops, Inc."
  );
});

test("allowIssuerCNs uses the same RFC 4514 parser in structured mode", async () => {
  const a = () =>
    structured({ allowSubjectCNs: undefined, allowIssuerCNs: ["root-ca"] });
  assert.equal((await a().fetch(sReq("CN=svc", "OU=x\\,CN=root-ca,O=evil"))).status, 403);
  assert.equal((await a().fetch(sReq("CN=svc", "CN=root-ca,O=acme"))).status, 200);
});

test("DN escapes are decoded and malformed or multi-CN DNs fail closed", () => {
  const cn = (dn: string) =>
    parseForwardedClientCert(`Hash=ab;Subject="${dn}"`)?.subjectCN;
  // Happy: escapes and hex pairs decode into the CN value.
  assert.equal(cn("CN=a\\2Cb\\C3\\A9,O=x"), "a,bé");
  assert.equal(cn("CN=a\\+b\\;c\\\\d,O=x"), "a+b;c\\d");
  assert.equal(cn("O=x+CN=svc;C=NO"), "svc");
  // Unhappy: ambiguous or malformed input yields no CN.
  for (const dn of [
    "CN=a+CN=b",
    "CN=a,CN=b",
    "CN=a,2.5.4.3=b",
    "CN=a\\q",
    "CN=a\\4",
    "CN=\\FF",
    "CN=#0403",
    "O=x,,CN=a",
    "CN=a,",
    "CN",
    "CN=x\\\"y",
  ]) {
    assert.equal(cn(dn), undefined, dn);
  }
});

test("allowSANs: a typed entry matches only the exact SAN, never a doubled type prefix", async () => {
  const run = async (sans: string[], allowSANs: string[]) => {
    const a = new App({ env: "development" });
    a.use(clientCertAuth({ allowSANs }));
    a.route({
      method: "GET",
      path: "/",
      responses: { 200: { description: "ok" } },
      handler: () => ({ status: 200 as const, body: { ok: true } }),
    });
    const req = new Request("http://x/");
    setClientCertificate(req, { subjectAltNames: sans, verified: true });
    return (await a.fetch(req)).status;
  };
  assert.equal(await run(["URI:URI:spiffe://a"], ["URI:spiffe://a"]), 403);
  assert.equal(await run(["URI:spiffe://a"], ["URI:spiffe://a"]), 200);
  // Bare entries keep matching the value part of any typed SAN.
  assert.equal(await run(["URI:spiffe://a"], ["spiffe://a"]), 200);
});
