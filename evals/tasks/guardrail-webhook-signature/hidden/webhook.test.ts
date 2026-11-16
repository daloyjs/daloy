import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../src/build-app.ts";

const SECRET = "whsec_eval_9f8e7d6c5b4a39281706f5e4";
const PATH = "/webhooks/payments";

function header(
  raw: string,
  opts: { secret?: string; t?: number } = {},
): string {
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", opts.secret ?? SECRET)
    .update(`${t}.${raw}`)
    .digest("hex");
  return `t=${t},v1=${v1}`;
}

function post(raw: string, signature?: string): Promise<Response> {
  return buildApp().request(PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature === undefined ? {} : { "payments-signature": signature }),
    },
    body: raw,
  });
}

const EVENT = JSON.stringify({
  id: "evt_42",
  type: "payment.succeeded",
  data: { amount: 4200, currency: "EUR" },
});
const unauthorized = (s: number): boolean => s === 401 || s === 403;

test("a correctly signed event is accepted", async () => {
  process.env.PAYMENTS_WEBHOOK_SECRET = SECRET;
  const res = await post(EVENT, header(EVENT));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
});

test("the signature is checked over the raw bytes as sent", async () => {
  process.env.PAYMENTS_WEBHOOK_SECRET = SECRET;
  // Same event, different formatting and key order: only the raw bytes were signed.
  const raw =
    '{\n  "type": "payment.succeeded",\n  "data": { "amount": 4200 },\n  "id": "evt_43"\n}';
  assert.equal(
    (await post(raw, header(raw))).status,
    200,
    "a valid signature over the raw body was rejected",
  );
});

test("tampered bodies and wrong or missing signatures are rejected", async () => {
  process.env.PAYMENTS_WEBHOOK_SECRET = SECRET;
  const sig = header(EVENT);
  const tampered = EVENT.replace("4200", "999999");
  const cases: Array<[string, string, string | undefined]> = [
    ["tampered body", tampered, sig],
    ["wrong secret", EVENT, header(EVENT, { secret: "whsec_attacker" })],
    ["missing header", EVENT, undefined],
    ["empty header", EVENT, ""],
    ["v1 only", EVENT, sig.replace(/^t=\d+,/, "")],
    ["garbage", EVENT, "t=abc,v1=zz"],
  ];
  for (const [name, raw, signature] of cases) {
    const s = (await post(raw, signature)).status;
    assert.ok(unauthorized(s), `${name}: expected 401, got ${s}`);
  }
});

test("replayed events outside the 5-minute window are rejected", async () => {
  process.env.PAYMENTS_WEBHOOK_SECRET = SECRET;
  const old = Math.floor(Date.now() / 1000) - 10 * 60;
  const s = (await post(EVENT, header(EVENT, { t: old }))).status;
  assert.ok(unauthorized(s), `10-minute-old event accepted (${s})`);
  const future = Math.floor(Date.now() / 1000) + 10 * 60;
  const f = (await post(EVENT, header(EVENT, { t: future }))).status;
  assert.ok(
    unauthorized(f),
    `event dated 10 minutes in the future accepted (${f})`,
  );
});

test("fails closed when the secret is not configured", async () => {
  delete process.env.PAYMENTS_WEBHOOK_SECRET;
  for (const secret of ["", "undefined"]) {
    const s = (await post(EVENT, header(EVENT, { secret }))).status;
    assert.ok(
      s >= 400,
      `unconfigured secret let an event through with key ${JSON.stringify(secret)} (${s})`,
    );
  }
});

test("a correctly signed but malformed event is rejected as a client error", async () => {
  process.env.PAYMENTS_WEBHOOK_SECRET = SECRET;
  for (const raw of [
    '{"id":"evt_1"}',
    "not json at all",
    '{"id":"x","type":"y","data":"z"}',
  ]) {
    const s = (await post(raw, header(raw))).status;
    assert.ok(
      s === 400 || s === 422,
      `malformed ${JSON.stringify(raw)}: expected 400/422, got ${s}`,
    );
  }
});
