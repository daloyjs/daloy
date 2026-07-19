import { test } from "node:test";
import assert from "node:assert/strict";
import {
  App,
  clientCertAuth,
  setClientCertificate,
  getClientCertificate,
  normalizePeerCertificate,
  parseForwardedClientCert,
  type ClientCertificate,
} from "../src/index.js";

// ---------- helpers ----------

function makeApp(): App {
  return new App({ env: "development" });
}

function guardedApp(opts?: Parameters<typeof clientCertAuth>[0]): App {
  const app = makeApp();
  app.use(clientCertAuth(opts));
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

const VERIFIED_CERT: ClientCertificate = {
  subjectDN: "CN=svc-a,OU=payments,O=acme",
  subjectCN: "svc-a",
  issuerDN: "CN=acme-internal-ca,O=acme",
  issuerCN: "acme-internal-ca",
  serialNumber: "0A1B2C",
  fingerprint256: "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899",
  subjectAltNames: ["URI:spiffe://acme/svc-a", "DNS:svc-a.internal"],
  verified: true,
};

// ---------- parseForwardedClientCert (Envoy XFCC) ----------

test("parseForwardedClientCert parses an Envoy XFCC element", () => {
  const header =
    'Hash=49b4d7c...;Subject="CN=svc-a,OU=payments,O=acme";URI=spiffe://acme/svc-a;DNS=svc-a.internal';
  const cert = parseForwardedClientCert(header);
  assert.ok(cert);
  assert.equal(cert.subjectDN, "CN=svc-a,OU=payments,O=acme");
  assert.equal(cert.subjectCN, "svc-a");
  assert.equal(cert.fingerprint256, "49B4D7C...");
  assert.deepEqual(cert.subjectAltNames, [
    "URI:spiffe://acme/svc-a",
    "DNS:svc-a.internal",
  ]);
  assert.equal(cert.verified, true);
});

test("parseForwardedClientCert keeps only the first (client) element", () => {
  const header =
    'Subject="CN=client";DNS=client.example,' + 'Subject="CN=intermediate";DNS=proxy.example';
  const cert = parseForwardedClientCert(header);
  assert.ok(cert);
  assert.equal(cert.subjectCN, "client");
  assert.deepEqual(cert.subjectAltNames, ["DNS:client.example"]);
});

test("parseForwardedClientCert URL-decodes a forwarded PEM", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----";
  const header = `Hash=abc;Cert="${encodeURIComponent(pem)}"`;
  const cert = parseForwardedClientCert(header);
  assert.ok(cert);
  assert.equal(cert.pem, pem);
});

test("parseForwardedClientCert returns undefined for empty/garbage input", () => {
  assert.equal(parseForwardedClientCert(undefined), undefined);
  assert.equal(parseForwardedClientCert(""), undefined);
  assert.equal(parseForwardedClientCert("   "), undefined);
  assert.equal(parseForwardedClientCert("By=spiffe://x"), undefined);
});

// ---------- normalizePeerCertificate (Node getPeerCertificate shape) ----------

test("normalizePeerCertificate maps a Node peer-certificate object", () => {
  const cert = normalizePeerCertificate(
    {
      subject: { CN: "svc-a", OU: "payments", O: "acme" },
      issuer: { CN: "acme-internal-ca", O: "acme" },
      valid_from: "May  1 00:00:00 2026 GMT",
      valid_to: "May  1 00:00:00 2027 GMT",
      fingerprint256: "AA:BB:CC:DD",
      serialNumber: "0A1B2C",
      subjectaltname: "DNS:svc-a.internal, IP Address:10.0.0.7, URI:spiffe://acme/svc-a",
    },
    true,
  );
  assert.ok(cert);
  assert.equal(cert.subjectCN, "svc-a");
  assert.equal(cert.issuerCN, "acme-internal-ca");
  assert.equal(cert.fingerprint256, "AABBCCDD");
  assert.deepEqual(cert.subjectAltNames, [
    "DNS:svc-a.internal",
    "IP:10.0.0.7",
    "URI:spiffe://acme/svc-a",
  ]);
  assert.equal(cert.verified, true);
  assert.ok(cert.notBefore instanceof Date);
  assert.ok(cert.notAfter instanceof Date);
});

test("normalizePeerCertificate returns undefined for the empty cert object", () => {
  assert.equal(normalizePeerCertificate({}, false), undefined);
  assert.equal(normalizePeerCertificate(null, false), undefined);
  assert.equal(normalizePeerCertificate(undefined, true), undefined);
});

test("normalizePeerCertificate handles multi-valued DN entries", () => {
  const cert = normalizePeerCertificate(
    { subject: { CN: "svc-a", OU: ["payments", "eng"] } },
    false,
  );
  assert.ok(cert);
  assert.equal(cert.subjectDN, "CN=svc-a,OU=payments,OU=eng");
  assert.equal(cert.verified, false);
});

// ---------- setClientCertificate / getClientCertificate ----------

test("getClientCertificate resolves and caches a lazy thunk once", () => {
  const req = new Request("http://x/");
  let calls = 0;
  setClientCertificate(req, () => {
    calls++;
    return VERIFIED_CERT;
  });
  assert.equal(getClientCertificate(req)?.subjectCN, "svc-a");
  assert.equal(getClientCertificate(req)?.subjectCN, "svc-a");
  assert.equal(calls, 1);
});

test("getClientCertificate returns undefined when nothing was attached", () => {
  assert.equal(getClientCertificate(new Request("http://x/")), undefined);
});

// ---------- clientCertAuth: native source (happy paths) ----------

test("clientCertAuth accepts a verified cert and stamps ctx.state", async () => {
  const app = makeApp();
  app.use(clientCertAuth());
  app.route({
    method: "GET",
    path: "/",
    responses: { 200: { description: "ok" } },
    handler: (ctx) => ({
      status: 200 as const,
      body: {
        cn: (ctx.state as Record<string, ClientCertificate>).clientCertificate?.subjectCN,
      },
    }),
  });
  const req = new Request("http://x/");
  setClientCertificate(req, VERIFIED_CERT);
  const res = await app.fetch(req);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { cn: "svc-a" });
});

test("clientCertAuth enforces a subject-CN allow-list", async () => {
  const app = guardedApp({ allowSubjectCNs: ["svc-a"] });
  const req = new Request("http://x/");
  setClientCertificate(req, VERIFIED_CERT);
  assert.equal((await app.fetch(req)).status, 200);

  const app2 = guardedApp({ allowSubjectCNs: ["svc-b"] });
  const req2 = new Request("http://x/");
  setClientCertificate(req2, VERIFIED_CERT);
  assert.equal((await app2.fetch(req2)).status, 403);
});

test("clientCertAuth enforces issuer-CN, fingerprint, and SAN allow-lists", async () => {
  const okApp = guardedApp({
    allowIssuerCNs: ["acme-internal-ca"],
    allowFingerprints: ["aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99"],
    allowSANs: ["spiffe://acme/svc-a"],
  });
  const req = new Request("http://x/");
  setClientCertificate(req, VERIFIED_CERT);
  assert.equal((await okApp.fetch(req)).status, 200);

  const badFp = guardedApp({ allowFingerprints: ["DEADBEEF"] });
  const req2 = new Request("http://x/");
  setClientCertificate(req2, VERIFIED_CERT);
  assert.equal((await badFp.fetch(req2)).status, 403);

  const badSan = guardedApp({ allowSANs: ["URI:spiffe://acme/other"] });
  const req3 = new Request("http://x/");
  setClientCertificate(req3, VERIFIED_CERT);
  assert.equal((await badSan.fetch(req3)).status, 403);
});

test("clientCertAuth SAN match accepts both TYPE:value and bare value", async () => {
  const typed = guardedApp({ allowSANs: ["URI:spiffe://acme/svc-a"] });
  const bare = guardedApp({ allowSANs: ["spiffe://acme/svc-a"] });
  for (const app of [typed, bare]) {
    const req = new Request("http://x/");
    setClientCertificate(req, VERIFIED_CERT);
    assert.equal((await app.fetch(req)).status, 200);
  }
});

// ---------- clientCertAuth: unhappy paths ----------

test("clientCertAuth returns 401 with no-store when no cert is presented", async () => {
  const app = guardedApp();
  const res = await app.fetch(new Request("http://x/"));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "application/problem+json");
  const body = await res.json();
  assert.equal((body as { title: string }).title, "Client certificate required");
});

test("clientCertAuth rejects an unverified cert by default", async () => {
  const app = guardedApp();
  const req = new Request("http://x/");
  setClientCertificate(req, { ...VERIFIED_CERT, verified: false });
  assert.equal((await app.fetch(req)).status, 403);
});

test("clientCertAuth requireVerified:false accepts an unverified cert", async () => {
  const app = guardedApp({ requireVerified: false });
  const req = new Request("http://x/");
  setClientCertificate(req, { ...VERIFIED_CERT, verified: false });
  assert.equal((await app.fetch(req)).status, 200);
});

test("clientCertAuth rejects a cert outside its validity window", async () => {
  const future = guardedApp({
    now: () => Date.parse("2020-01-01T00:00:00Z"),
  });
  const req = new Request("http://x/");
  setClientCertificate(req, {
    ...VERIFIED_CERT,
    notBefore: new Date("2026-01-01T00:00:00Z"),
    notAfter: new Date("2027-01-01T00:00:00Z"),
  });
  assert.equal((await future.fetch(req)).status, 403);

  const expired = guardedApp({ now: () => Date.parse("2030-01-01T00:00:00Z") });
  const req2 = new Request("http://x/");
  setClientCertificate(req2, {
    ...VERIFIED_CERT,
    notBefore: new Date("2026-01-01T00:00:00Z"),
    notAfter: new Date("2027-01-01T00:00:00Z"),
  });
  assert.equal((await expired.fetch(req2)).status, 403);
});

test("clientCertAuth checkValidity:false skips the validity window", async () => {
  const app = guardedApp({
    checkValidity: false,
    now: () => Date.parse("2030-01-01T00:00:00Z"),
  });
  const req = new Request("http://x/");
  setClientCertificate(req, {
    ...VERIFIED_CERT,
    notAfter: new Date("2027-01-01T00:00:00Z"),
  });
  assert.equal((await app.fetch(req)).status, 200);
});

test("clientCertAuth runs a custom verify hook and rejects on false", async () => {
  const reject = guardedApp({ verify: () => false });
  const req = new Request("http://x/");
  setClientCertificate(req, VERIFIED_CERT);
  assert.equal((await reject.fetch(req)).status, 403);

  const accept = guardedApp({ verify: (cert) => cert.subjectCN === "svc-a" });
  const req2 = new Request("http://x/");
  setClientCertificate(req2, VERIFIED_CERT);
  assert.equal((await accept.fetch(req2)).status, 200);
});

// ---------- clientCertAuth: header sources ----------

test("clientCertAuth reads an Envoy XFCC header", async () => {
  const app = guardedApp({
    header: { format: "xfcc" },
    allowSubjectCNs: ["svc-a"],
  });
  const res = await app.fetch(
    new Request("http://x/", {
      headers: {
        "x-forwarded-client-cert": 'Hash=abc;Subject="CN=svc-a,O=acme";URI=spiffe://acme/svc-a',
      },
    }),
  );
  assert.equal(res.status, 200);
});

test("clientCertAuth reads nginx-style structured headers", async () => {
  const app = guardedApp({
    header: {
      format: "structured",
      subjectDN: "x-ssl-client-s-dn",
      issuerDN: "x-ssl-client-i-dn",
      fingerprint: "x-ssl-client-fingerprint",
      verify: "x-ssl-client-verify",
    },
    allowIssuerCNs: ["acme-internal-ca"],
  });
  const ok = await app.fetch(
    new Request("http://x/", {
      headers: {
        "x-ssl-client-s-dn": "CN=svc-a,O=acme",
        "x-ssl-client-i-dn": "CN=acme-internal-ca,O=acme",
        "x-ssl-client-fingerprint": "AABBCC",
        "x-ssl-client-verify": "SUCCESS",
      },
    }),
  );
  assert.equal(ok.status, 200);

  // Verify header != SUCCESS → unverified → 403.
  const failed = await app.fetch(
    new Request("http://x/", {
      headers: {
        "x-ssl-client-s-dn": "CN=svc-a,O=acme",
        "x-ssl-client-i-dn": "CN=acme-internal-ca,O=acme",
        "x-ssl-client-verify": "FAILED:certificate has expired",
      },
    }),
  );
  assert.equal(failed.status, 403);
});

test("clientCertAuth returns 401 when the configured header is absent", async () => {
  const app = guardedApp({ header: { format: "xfcc" } });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 401);
});

test("clientCertAuth rejects an empty structured header config", () => {
  assert.throws(
    () => clientCertAuth({ header: { format: "structured" } }),
    /at least one of/,
  );
});

test("clientCertAuth rejects an unknown header format", () => {
  assert.throws(
    // @ts-expect-error intentionally invalid
    () => clientCertAuth({ header: { format: "bogus" } }),
    /xfcc.*structured/,
  );
});

test("clientCertAuth honors a custom resolve function", async () => {
  const app = guardedApp({
    resolve: () => VERIFIED_CERT,
    allowSubjectCNs: ["svc-a"],
  });
  assert.equal((await app.fetch(new Request("http://x/"))).status, 200);
});

test("clientCertAuth structured headers without verify header are unverified by default", async () => {
  const app = guardedApp({
    header: {
      format: "structured",
      subjectDN: "x-ssl-client-s-dn",
      // no verify header configured
    },
  });
  const res = await app.fetch(
    new Request("http://x/", {
      headers: { "x-ssl-client-s-dn": "CN=attacker" },
    }),
  );
  assert.equal(res.status, 403, "identity-only headers must not satisfy requireVerified");
});
