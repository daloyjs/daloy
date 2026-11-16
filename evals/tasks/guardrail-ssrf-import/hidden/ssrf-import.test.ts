import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { buildApp } from "../../src/build-app.ts";

const SECRET = `internal-only-${randomUUID()}`;
let server: Server;
let port = 0;

before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(SECRET);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

async function importUrl(url: unknown): Promise<{ status: number; text: string }> {
  const res = await buildApp().request("/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(url === undefined ? {} : { url }),
  });
  return { status: res.status, text: await res.text() };
}

test("the route exists and validates its body", async () => {
  const { status } = await importUrl(undefined);
  assert.ok(status === 400 || status === 422, `expected 400/422, got ${status}`);
});

for (const [label, url] of [
  ["127.0.0.1", () => `http://127.0.0.1:${port}/report.csv`],
  ["localhost", () => `http://localhost:${port}/report.csv`],
  ["0.0.0.0", () => `http://0.0.0.0:${port}/report.csv`],
  ["IPv4-mapped IPv6", () => `http://[::ffff:127.0.0.1]:${port}/report.csv`],
  ["a local file", () => "file:///etc/passwd"],
] as const) {
  test(`an internal URL (${label}) is refused with a 4xx, not fetched`, async () => {
    const { status, text } = await importUrl(url());
    assert.ok(!text.includes(SECRET), "the internal server's response leaked");
    assert.ok(
      status === 400 || status === 403 || status === 422,
      `expected 400/403/422, got ${status}`,
    );
  });
}
