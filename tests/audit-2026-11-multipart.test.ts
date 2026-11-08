import { test } from "node:test";
import assert from "node:assert/strict";
import { fileField, multipartObject } from "../src/multipart.js";

// Regression tests for the 2026-11 audit of `rejectScriptableImages` and
// `multipartObject({ strict: true })`.

const enc = new TextEncoder();
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';

function utf16(s: string, le: boolean, bom: boolean): Uint8Array {
  const off = bom ? 2 : 0;
  const b = new Uint8Array(off + s.length * 2);
  if (bom) {
    b[0] = le ? 0xff : 0xfe;
    b[1] = le ? 0xfe : 0xff;
  }
  for (let i = 0; i < s.length; i++) b[off + 2 * i + (le ? 0 : 1)] = s.charCodeAt(i);
  return b;
}

async function check(bytes: Uint8Array | string, type = "image/svg+xml") {
  const schema = fileField({ accept: ["image/*"], rejectScriptableImages: true });
  const data = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  return schema["~standard"].validate(new File([data as BlobPart], "a.img", { type }));
}

async function assertRejected(bytes: Uint8Array | string, label: string): Promise<void> {
  const r = await check(bytes);
  assert.ok(r.issues, `expected ${label} to be rejected`);
  assert.match(r.issues![0]!.message, /Refusing scriptable image format/);
}

test("rejectScriptableImages: plain SVG and single-space MVG controls are still rejected", async () => {
  await assertRejected(SVG, "plain svg");
  await assertRejected("push graphic-context\nviewbox 0 0 1 1\n", "mvg");
  await assertRejected("%!PS-Adobe-3.0 EPSF-3.0\n", "postscript");
});

test("rejectScriptableImages: SVG behind a leading XML comment is rejected", async () => {
  await assertRejected(`<!-- x -->${SVG}`, "comment-prefixed svg");
  await assertRejected(`<?xml version="1.0"?>\n<!-- a -->\n<!-- b -->${SVG}`, "pi + comments");
});

test("rejectScriptableImages: namespace-prefixed SVG root is rejected", async () => {
  await assertRejected(
    '<?xml version="1.0"?><s:svg xmlns:s="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    "ns-prefixed svg"
  );
  await assertRejected('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>', "svg:svg");
});

test("rejectScriptableImages: SVG after a DOCTYPE with an internal subset is rejected", async () => {
  await assertRejected(
    `<!DOCTYPE foo [<!ENTITY x "y">]>\n<SVG\txmlns="http://www.w3.org/2000/svg">`,
    "doctype + uppercase svg"
  );
});

test("rejectScriptableImages: UTF-16 SVG (BOM or NUL-interleaved) is rejected", async () => {
  await assertRejected(utf16(SVG, true, true), "utf-16le bom");
  await assertRejected(utf16(SVG, false, true), "utf-16be bom");
  await assertRejected(utf16(SVG, true, false), "utf-16le no bom");
  await assertRejected(utf16(SVG, false, false), "utf-16be no bom");
});

test("rejectScriptableImages: whitespace variants of MVG / MSL keywords are rejected", async () => {
  await assertRejected("push  graphic-context\nviewbox 0 0 1 1\n", "double-space mvg");
  await assertRejected("push\t\tgraphic-context\n", "tab mvg");
  await assertRejected("viewbox\t0 0 1 1\nfill 'url(https://x/)'\n", "viewbox-first mvg");
  await assertRejected('<?xml version="1.0"?>\n<msl\n><image filename="x"/></msl>', "msl");
  await assertRejected(utf16("push graphic-context\n", true, true), "utf-16 mvg");
});

test("rejectScriptableImages: binary PNG/JPEG/GIF/WebP headers are never flagged", async () => {
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
  ]);
  const jpegXmp = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x80,
    ...enc.encode(
      'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description/></rdf:RDF></x:xmpmeta>'
    ),
  ]);
  const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const gif = new Uint8Array([...enc.encode("GIF89a"), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x21, 0xf9]);
  const webp = new Uint8Array([...enc.encode("RIFF"), 0x24, 0, 0, 0, ...enc.encode("WEBPVP8 "), 0x18, 0, 0, 0, 0x30, 1, 0, 0x9d, 1, 0x2a, 1, 0, 1, 0]);
  for (const [label, bytes, type] of [
    ["png", png, "image/png"],
    ["jpeg-xmp", jpegXmp, "image/jpeg"],
    ["jpeg-jfif", jfif, "image/jpeg"],
    ["gif", gif, "image/gif"],
    ["webp", webp, "image/webp"],
  ] as const) {
    const r = await check(bytes, type);
    assert.equal(r.issues, undefined, `${label} must not be flagged`);
  }
});

test("rejectScriptableImages: plain text that merely mentions svg is not flagged", async () => {
  const r = await check("an svg-free note about svgs and <svgish> tags", "image/png");
  assert.equal(r.issues, undefined);
});

test("multipartObject strict: inherited names like toString are unknown fields", async () => {
  const schema = multipartObject({ title: { "~standard": { version: 1, vendor: "t", validate: (v: unknown) => ({ value: v }) } } }, { strict: true });
  const bad = await schema["~standard"].validate({ title: "a", toString: "x" });
  assert.ok(bad.issues);
  assert.equal(bad.issues![0]!.message, 'Unknown field "toString"');
  const good = await schema["~standard"].validate({ title: "a" });
  assert.deepEqual(good, { value: { title: "a" } });
});

test("multipartObject strict: unknown-field message strips bidi and control characters", async () => {
  const schema = multipartObject({}, { strict: true });
  const r = await schema["~standard"].validate({ ["‮evil\u0007"]: "x" });
  assert.ok(r.issues);
  assert.equal(r.issues![0]!.message, 'Unknown field "evil"');
});

test("multipartObject non-strict: undeclared extras are dropped from the output", async () => {
  const schema = multipartObject({});
  const r = await schema["~standard"].validate({ zzz: "x" });
  assert.deepEqual(r, { value: {} });
});

test("fileField magicBytes: declared-MIME mismatch message is echo-safe", async () => {
  const schema = fileField({
    accept: ["image/png", "application/*"],
    magicBytes: { bytes: [0x89, 0x50, 0x4e, 0x47], label: "PNG", mime: "image/png" },
    rejectScriptableImages: false,
  });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const blob = new Blob([png]);
  // A Blob-like value from a non-standard parser can carry any type string.
  const spoofed = {
    size: blob.size,
    type: "application/x-\u202eevil\u0007",
    name: "a.png",
    arrayBuffer: () => blob.arrayBuffer(),
    slice: (a?: number, b?: number) => blob.slice(a, b),
  };
  const r = await schema["~standard"].validate(spoofed);
  assert.ok(r.issues);
  assert.match(r.issues![0]!.message, /^Declared MIME "application\/x-evil" does not match/);

  const ok = await schema["~standard"].validate(new File([png], "a.png", { type: "image/png" }));
  assert.equal(ok.issues, undefined);
});

// --- Cloudflare security-audit run-1 (2026-11-08): the probe window was 512 ---
// bytes, so a >512-byte XML prolog hid a scriptable root. The probe now reads
// a bounded 64 KiB window and fails closed when the window is entirely prolog
// material while the file continues.
// Fingerprint: daloy-core:multipart-scriptable-image-probe-window-bypass

test("rejectScriptableImages: SVG hidden behind a >512-byte comment prolog is rejected", async () => {
  const padded = `<?xml version="1.0"?>\n<!-- ${"pad ".repeat(300)} -->\n${SVG}`;
  assert.ok(padded.length > 512 && padded.length < 64 * 1024);
  await assertRejected(padded, "svg root beyond the old 512-byte window");
});

test("rejectScriptableImages: a prolog longer than the 64 KiB window fails closed", async () => {
  const schema = fileField({ accept: ["image/*"], rejectScriptableImages: true });
  // The whole probe window is XML-legal prolog (a giant comment) and the
  // scriptable root sits beyond it — the root is unverifiable, so the
  // upload must be refused rather than admitted on an unread suffix.
  const huge = `<?xml version="1.0"?>\n<!-- ${"x".repeat(70 * 1024)} -->\n${SVG}`;
  const r = await schema["~standard"].validate(new File([huge], "a.svg", { type: "image/svg+xml" }));
  assert.ok(r.issues, "all-prolog window with a continuing file must be refused");
  assert.match(r.issues![0]!.message, /prolog/);
});

test("rejectScriptableImages: a giant but complete prolog within the window still detects the root", async () => {
  // 40 KB of comment fits inside the 64 KiB window: not truncated, so the
  // scriptable root IS probed and rejected by the normal svg rule.
  await assertRejected(`<!-- ${"y".repeat(40 * 1024)} -->\n${SVG}`, "40k comment then svg");
});

test("rejectScriptableImages: small in-window prolog-only files are not newly rejected", async () => {
  // Not truncated → the fail-closed prolog rule does not apply; a tiny XML
  // fragment with no scriptable content passes exactly as before.
  const r = await check('<?xml version="1.0"?>\n<!-- just a note -->\n', "image/svg+xml");
  assert.equal(r.issues, undefined);
});

test("rejectScriptableImages: large binary uploads are unaffected by the prolog rule", async () => {
  // A >64 KiB binary payload is truncated by the probe window but is not
  // prolog material, so it must not be refused by the new rule.
  const png = new Uint8Array(80 * 1024);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const r = await check(png, "image/png");
  assert.equal(r.issues, undefined, "truncated binary probe must not fail closed");
});

test("rejectScriptableImages: >64 KiB of genuine whitespace padding ahead of a root fails closed", async () => {
  // XML allows whitespace ahead of the root element, so whitespace padding
  // is as much a window-evasion vector as a giant comment.
  const r = await check(`${" \n\t".repeat(24 * 1024)}${SVG}`, "image/svg+xml");
  assert.ok(r.issues, "whitespace-only window with a continuing file must be refused");
  assert.match(r.issues![0]!.message, /prolog/);
});

test("rejectScriptableImages: a >64 KiB zero-padded binary is NOT mistaken for a blank XML prolog", async () => {
  // asciiPrefix folds non-printable bytes to spaces; a window of binary
  // padding is not XML whitespace and must not trip the fail-closed rule.
  const zeroPadded = new Uint8Array(96 * 1024);
  zeroPadded.set([0x89, 0x50, 0x4e, 0x47], 80 * 1024);
  const r = await check(zeroPadded, "image/png");
  assert.equal(r.issues, undefined, "non-printable padding is not an XML prolog");
  const highBytes = new Uint8Array(96 * 1024).fill(0xff);
  const r2 = await check(highBytes, "image/png");
  assert.equal(r2.issues, undefined);
});
