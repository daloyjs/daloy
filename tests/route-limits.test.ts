/**
 * Per-route `bodyLimitBytes` / `requestTimeoutMs` overrides (1.21.0).
 *
 * The app-wide values stay the default; a route may raise or lower either
 * for itself only. Every body-read path (schema parser, raw `ctx.request`
 * reads, preBody hooks, global onRequest re-cap, decompression re-check,
 * idempotency fingerprint) must honor the route value, and the override must
 * never leak to sibling routes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { App, bearerAuth, idempotency, requestDecompression } from "../src/index.js";
import { runCli, type CliIO } from "../src/cli.js";

const APP_LIMIT = 1024;

function chunkedBody(bytes: number): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
        pull(c) {
            if (sent >= bytes) return c.close();
            const n = Math.min(512, bytes - sent);
            sent += n;
            c.enqueue(new Uint8Array(n).fill(0x61));
        },
    });
}

function streamingPost(url: string, bytes: number, headers: Record<string, string> = {}): Request {
    return new Request(url, {
        method: "POST",
        headers: { "content-type": "text/plain", ...headers },
        body: chunkedBody(bytes),
        duplex: "half",
    } as RequestInit);
}

function jsonPost(url: string, bytes: number, headers: Record<string, string> = {}): Request {
    return new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ a: "x".repeat(bytes) }),
    });
}

const raw = { responses: { 200: { description: "ok" } }, acknowledgeNoResponseBodySchema: true } as const;
const echoLength = async (ctx: { request: Request }) =>
    new Response(String((await ctx.request.arrayBuffer()).byteLength));

// ---------- registration-time validation ----------

test("[unhappy] route bodyLimitBytes / requestTimeoutMs refuse NaN, Infinity, negatives, non-integers, strings", () => {
    const app = new App({ logger: false });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "1024"]) {
        assert.throws(
            () => app.post("/u", { ...raw, bodyLimitBytes: bad as never }, () => new Response("x")),
            /app\.route\(\): bodyLimitBytes on POST \/u must be a finite, non-negative integer/,
            `bodyLimitBytes ${String(bad)} must be refused`,
        );
        assert.throws(
            () => app.post("/t", { ...raw, requestTimeoutMs: bad as never }, () => new Response("x")),
            /app\.route\(\): requestTimeoutMs on POST \/t must be a finite, non-negative integer/,
            `requestTimeoutMs ${String(bad)} must be refused`,
        );
    }
    // An explicit undefined inherits the app value.
    assert.doesNotThrow(() =>
        app.post("/ok", { ...raw, bodyLimitBytes: undefined, requestTimeoutMs: undefined }, () => new Response("x")),
    );
});

// ---------- raw-body routes ----------

test("route bodyLimitBytes raises the cap for that route only; siblings keep the app limit", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.post("/upload", { ...raw, bodyLimitBytes: 8 * APP_LIMIT }, echoLength);
    app.post("/other", raw, echoLength);

    const big = await app.fetch(streamingPost("http://x/upload", 4 * APP_LIMIT));
    assert.equal(big.status, 200);
    assert.equal(await big.text(), String(4 * APP_LIMIT));
    // Past the route's own cap is still refused.
    assert.equal((await app.fetch(streamingPost("http://x/upload", 9 * APP_LIMIT))).status, 413);
    // The sibling never saw the raised limit.
    assert.equal((await app.fetch(streamingPost("http://x/other", 4 * APP_LIMIT))).status, 413);
    assert.equal((await app.fetch(streamingPost("http://x/other", APP_LIMIT))).status, 200);
});

test("route bodyLimitBytes lowers the cap below the app limit", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.post("/login", { ...raw, bodyLimitBytes: 64 }, echoLength);
    assert.equal((await app.fetch(streamingPost("http://x/login", 512))).status, 413);
    // A declared Content-Length over the route cap is refused before any byte is read.
    const declared = await app.fetch(
        new Request("http://x/login", {
            method: "POST",
            headers: { "content-type": "text/plain", "content-length": "512" },
            body: "a".repeat(512),
        }),
    );
    assert.equal(declared.status, 413);
    const ok = await app.fetch(streamingPost("http://x/login", 32));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "32");
});

test("route bodyLimitBytes: 0 refuses every non-empty body on that route", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.post("/none", { ...raw, bodyLimitBytes: 0 }, echoLength);
    assert.equal((await app.fetch(streamingPost("http://x/none", 1))).status, 413);
    const empty = await app.fetch(new Request("http://x/none", { method: "POST" }));
    assert.equal(empty.status, 200);
    assert.equal(await empty.text(), "0");
});

// ---------- schema routes ----------

test("schema route: raised bodyLimitBytes is honored by the parser and by the Content-Length precheck", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    const schema = {
        request: { body: z.object({ a: z.string() }) },
        responses: { 200: { description: "ok", body: z.object({ n: z.number() }) } },
    };
    app.post("/wide", { ...schema, bodyLimitBytes: 8 * APP_LIMIT }, ({ body }) => ({
        status: 200 as const,
        body: { n: body.a.length },
    }));
    app.post("/narrow", schema, ({ body }) => ({ status: 200 as const, body: { n: body.a.length } }));

    const wide = await app.fetch(jsonPost("http://x/wide", 4 * APP_LIMIT));
    assert.equal(wide.status, 200);
    assert.deepEqual(await wide.json(), { n: 4 * APP_LIMIT });
    assert.equal((await app.fetch(jsonPost("http://x/wide", 9 * APP_LIMIT))).status, 413);
    assert.equal((await app.fetch(jsonPost("http://x/narrow", 4 * APP_LIMIT))).status, 413);
    assert.equal((await app.fetch(jsonPost("http://x/narrow", 64))).status, 200);
});

test("schema route: a lowered bodyLimitBytes refuses a body the app limit would accept", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.post(
        "/tiny",
        {
            bodyLimitBytes: 32,
            request: { body: z.object({ a: z.string() }) },
            responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) } },
        },
        () => ({ status: 200 as const, body: { ok: true } }),
    );
    assert.equal((await app.fetch(jsonPost("http://x/tiny", 200))).status, 413);
    assert.equal((await app.fetch(jsonPost("http://x/tiny", 4))).status, 200);
});

// ---------- hooks: preBody, global onRequest, decompression ----------

test("preBody hook on a raised route can read up to the route cap, not past it", async () => {
    let readBytes = -1;
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.post(
        "/u",
        {
            ...raw,
            bodyLimitBytes: 4 * APP_LIMIT,
            hooks: {
                async preBody(ctx) {
                    readBytes = (await ctx.request.clone().arrayBuffer()).byteLength;
                },
            },
        },
        echoLength,
    );
    const ok = await app.fetch(streamingPost("http://x/u", 2 * APP_LIMIT));
    assert.equal(ok.status, 200);
    assert.equal(readBytes, 2 * APP_LIMIT);
    readBytes = -1;
    assert.equal((await app.fetch(streamingPost("http://x/u", 5 * APP_LIMIT))).status, 413);
    assert.equal(readBytes, -1, "the hook's over-limit read must reject");
});

test("regression: a raw route whose preBody hook clones the body still hands the handler the body", async () => {
    // Before 1.21.0 the post-preBody re-check re-wrapped the native stream that
    // the hook's clone() had already locked, so the handler read failed with 500.
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    let hookSaw = -1;
    app.post(
        "/raw",
        {
            ...raw,
            hooks: {
                async preBody(ctx) {
                    hookSaw = (await ctx.request.clone().arrayBuffer()).byteLength;
                },
            },
        },
        echoLength,
    );
    const res = await app.fetch(streamingPost("http://x/raw", 600));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "600");
    assert.equal(hookSaw, 600);
    assert.equal((await app.fetch(streamingPost("http://x/raw", 2 * APP_LIMIT))).status, 413);
});

test("global onRequest: the pre-route cap is replaced by the route's own limit once matched", async () => {
    const app = new App({
        logger: false,
        bodyLimitBytes: APP_LIMIT,
        hooks: { onRequest() { /* present so the body is capped before routing */ } },
    });
    app.post("/upload", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, echoLength);
    app.post("/login", { ...raw, bodyLimitBytes: 64 }, echoLength);
    app.post("/plain", raw, echoLength);

    const up = await app.fetch(streamingPost("http://x/upload", 3 * APP_LIMIT));
    assert.equal(up.status, 200);
    assert.equal(await up.text(), String(3 * APP_LIMIT));
    assert.equal((await app.fetch(streamingPost("http://x/upload", 5 * APP_LIMIT))).status, 413);
    assert.equal((await app.fetch(streamingPost("http://x/login", 512))).status, 413);
    assert.equal((await app.fetch(streamingPost("http://x/plain", 3 * APP_LIMIT))).status, 413);
    assert.equal((await app.fetch(streamingPost("http://x/plain", APP_LIMIT))).status, 200);
});

test("global onRequest that reads the body itself is still bounded by the app limit", async () => {
    let readBytes = -1;
    const app = new App({
        logger: false,
        bodyLimitBytes: APP_LIMIT,
        hooks: {
            async onRequest(request) {
                readBytes = (await request.clone().arrayBuffer()).byteLength;
            },
        },
    });
    app.post("/upload", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, echoLength);
    assert.equal((await app.fetch(streamingPost("http://x/upload", 2 * APP_LIMIT))).status, 413);
    assert.equal(readBytes, -1);
});

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    void writer.write(bytes as BufferSource);
    void writer.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

test("decompression re-check uses the route limit: an inflated body over the route cap is 413, under it passes", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.use(requestDecompression({ maxDecompressedBytes: 16 * APP_LIMIT, maxRatio: 10_000 }));
    app.post("/wide", { ...raw, bodyLimitBytes: 8 * APP_LIMIT }, echoLength);
    app.post("/narrow", { ...raw, bodyLimitBytes: 128 }, echoLength);
    const inflated = new Uint8Array(4 * APP_LIMIT).fill(0x61);
    const gz = await gzipBytes(inflated);
    const post = (path: string) =>
        app.fetch(
            new Request(`http://x${path}`, {
                method: "POST",
                headers: { "content-type": "text/plain", "content-encoding": "gzip" },
                body: gz as BodyInit,
            }),
        );
    const wide = await post("/wide");
    assert.equal(wide.status, 200);
    assert.equal(await wide.text(), String(4 * APP_LIMIT));
    assert.equal((await post("/narrow")).status, 413);
});

// ---------- idempotency fingerprint ----------

test("idempotency: the raw-body fingerprint read is bounded by the route limit, not the app limit", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    let calls = 0;
    app.use(idempotency({ maxFingerprintBodyBytes: 8 * APP_LIMIT }));
    app.post("/charge", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, async (ctx) => {
        calls++;
        return new Response(String((await ctx.request.text()).length));
    });
    app.post("/small", { ...raw, bodyLimitBytes: 64 }, async (ctx) => new Response(await ctx.request.text()));
    const post = (path: string, key: string, body: string) =>
        app.fetch(
            new Request(`http://x${path}`, {
                method: "POST",
                headers: { "idempotency-key": key, "content-type": "text/plain", authorization: "Bearer u1" },
                body,
            }),
        );
    const payload = "a".repeat(2 * APP_LIMIT);
    const first = await post("/charge", "k1", payload);
    assert.equal(first.status, 200);
    assert.equal(await first.text(), String(2 * APP_LIMIT));
    const replay = await post("/charge", "k1", payload);
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotency-replayed"), "true");
    assert.equal(calls, 1);
    // A different body under the same key is still caught.
    assert.equal((await post("/charge", "k1", "b".repeat(2 * APP_LIMIT))).status, 422);
    // A lowered route limit bounds the fingerprint read too.
    assert.equal((await post("/small", "k2", "x".repeat(512))).status, 413);
});

// ---------- requestTimeoutMs ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("route requestTimeoutMs raises the deadline for that route only", async () => {
    const app = new App({ logger: false, requestTimeoutMs: 20 });
    app.get("/slow-ok", { ...raw, requestTimeoutMs: 500 }, async () => {
        await sleep(60);
        return new Response("done");
    });
    app.get("/slow-default", raw, async () => {
        await sleep(60);
        return new Response("done");
    });
    const ok = await app.fetch(new Request("http://x/slow-ok"));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "done");
    assert.equal((await app.fetch(new Request("http://x/slow-default"))).status, 408);
});

test("route requestTimeoutMs lowers the deadline below the app value and honors requestTimeoutStatus", async () => {
    const app = new App({ logger: false, requestTimeoutMs: 5_000, requestTimeoutStatus: 504 });
    app.get("/fast-only", { ...raw, requestTimeoutMs: 15 }, async () => {
        await sleep(80);
        return new Response("late");
    });
    app.get("/normal", raw, async () => {
        await sleep(30);
        return new Response("fine");
    });
    const res = await app.fetch(new Request("http://x/fast-only"));
    assert.equal(res.status, 504);
    assert.equal((await app.fetch(new Request("http://x/normal"))).status, 200);
});

test("route requestTimeoutMs: 0 disables the deadline on that route only", async () => {
    const app = new App({ logger: false, requestTimeoutMs: 15 });
    app.get("/unbounded", { ...raw, requestTimeoutMs: 0 }, async () => {
        await sleep(50);
        return new Response("done");
    });
    app.get("/bounded", raw, async () => {
        await sleep(50);
        return new Response("done");
    });
    assert.equal((await app.fetch(new Request("http://x/unbounded"))).status, 200);
    assert.equal((await app.fetch(new Request("http://x/bounded"))).status, 408);
});

test("route requestTimeoutMs covers the body read on a raised upload route", async () => {
    const app = new App({ logger: false, requestTimeoutMs: 5_000 });
    app.post("/u", { ...raw, bodyLimitBytes: 4 * APP_LIMIT, requestTimeoutMs: 20 }, echoLength);
    let pulls = 0;
    const trickle = new ReadableStream<Uint8Array>({
        async pull(c) {
            if (pulls++ >= 4) return c.close();
            await sleep(30);
            c.enqueue(new Uint8Array(16));
        },
    });
    const res = await app.fetch(
        new Request("http://x/u", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: trickle,
            duplex: "half",
        } as RequestInit),
    );
    assert.equal(res.status, 408);
});

// ---------- groups / plugins inherit and may override ----------

test("routes registered inside group() and register() resolve their own overrides against the app value", async () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.group("/v1", {}, (g) => {
        g.post("/upload", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, echoLength);
        g.post("/plain", raw, echoLength);
    });
    app.register((p) => {
        p.post("/ingest", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, echoLength);
    }, { prefix: "/plugin" });
    assert.equal((await app.fetch(streamingPost("http://x/v1/upload", 2 * APP_LIMIT))).status, 200);
    assert.equal((await app.fetch(streamingPost("http://x/v1/plain", 2 * APP_LIMIT))).status, 413);
    assert.equal((await app.fetch(streamingPost("http://x/plugin/ingest", 2 * APP_LIMIT))).status, 200);
});

// ---------- posture + doctor ----------

test("getSecurityPosture().routeOverrides lists only overriding routes with their auth state", () => {
    const app = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    app.post("/plain", raw, echoLength);
    app.post("/upload", { ...raw, bodyLimitBytes: 4 * APP_LIMIT, requestTimeoutMs: 60_000 }, echoLength);
    app.post(
        "/secure-upload",
        { ...raw, bodyLimitBytes: 4 * APP_LIMIT, hooks: bearerAuth({ validate: (t) => t === "tok" }) },
        echoLength,
    );
    app.get("/quick", { ...raw, requestTimeoutMs: 100 }, () => new Response("x"));
    const overrides = app.getSecurityPosture().routeOverrides;
    assert.deepEqual(
        overrides.map((o) => ({ ...o })),
        [
            { method: "POST", path: "/upload", bodyLimitBytes: 4 * APP_LIMIT, requestTimeoutMs: 60_000, authenticated: false },
            { method: "POST", path: "/secure-upload", bodyLimitBytes: 4 * APP_LIMIT, requestTimeoutMs: undefined, authenticated: true },
            { method: "GET", path: "/quick", bodyLimitBytes: undefined, requestTimeoutMs: 100, authenticated: false },
        ],
    );
    assert.ok(Object.isFrozen(overrides));
    assert.equal(new App({ logger: false }).getSecurityPosture().routeOverrides.length, 0);
});

function doctorCodes(app: App): Promise<string[]> {
    const out: string[] = [];
    const io: CliIO = {
        stdout: (chunk) => out.push(chunk),
        stderr: () => { },
        importEntry: async () => ({ default: app }),
        version: "0.0.0-test",
    };
    return runCli(["doctor", "--json", "entry.ts"], io).then((r) => {
        assert.equal(r.exitCode, 0);
        return (JSON.parse(out.join("")).findings as { code: string }[]).map((f) => f.code);
    });
}

test("doctor: a raised, unauthenticated route surfaces a warn; an authenticated or lowered one does not", async () => {
    const open = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    open.post("/upload", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, echoLength);
    assert.ok((await doctorCodes(open)).includes("audit.bodyLimit.routeRaisedUnauthenticated"));

    const guarded = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    guarded.use(bearerAuth({ validate: (t) => t === "tok" }));
    guarded.post("/upload", { ...raw, bodyLimitBytes: 4 * APP_LIMIT }, echoLength);
    assert.ok(!(await doctorCodes(guarded)).includes("audit.bodyLimit.routeRaisedUnauthenticated"));

    const lowered = new App({ logger: false, bodyLimitBytes: APP_LIMIT });
    lowered.post("/login", { ...raw, bodyLimitBytes: 64 }, echoLength);
    assert.ok(!(await doctorCodes(lowered)).includes("audit.bodyLimit.routeRaisedUnauthenticated"));
});

test("doctor: per-route cap over 25 MiB and per-route timeout of 0 each surface a warn", async () => {
    const app = new App({ logger: false });
    app.use(bearerAuth({ validate: (t) => t === "tok" }));
    app.post("/huge", { ...raw, bodyLimitBytes: 64 * 1024 * 1024 }, echoLength);
    app.get("/forever", { ...raw, requestTimeoutMs: 0 }, () => new Response("x"));
    const codes = await doctorCodes(app);
    assert.ok(codes.includes("audit.bodyLimit.routeBlanket"), codes.join(","));
    assert.ok(codes.includes("audit.requestTimeout.routeZero"), codes.join(","));
    assert.ok(!codes.includes("audit.bodyLimit.blanket"), "the app-level cap is untouched");
});
