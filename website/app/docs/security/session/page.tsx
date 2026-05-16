import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Sessions",
  description:
    "Use the built-in session() middleware for an edge-friendly signed-cookie session with a pluggable store, key rotation, and conservative __Host- defaults.",
  path: "/docs/security/session",
  keywords: [
    "DaloyJS sessions",
    "signed cookie session",
    "edge session middleware",
    "TypeScript session store",
    "key rotation",
    "__Host- cookie",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Sessions</h1>
      <p>
        DaloyJS ships a small, runtime-portable <code>session()</code> middleware: a signed
        <code>__Host-</code> cookie carries the session id, the payload lives in a pluggable{" "}
        <code>SessionStore</code> (in-memory by default; KV / Redis-shaped stores plug in directly),
        and per-request mutations are exposed on <code>ctx.state.session</code>. There are no
        adapter-specific code paths - the same middleware runs on Node, Bun, Deno, Cloudflare
        Workers, and Vercel Edge because it only uses <code>WebCrypto</code> and standard{" "}
        <code>Set-Cookie</code> headers.
      </p>

      <h2>Quick start</h2>
      <CodeBlock code={`import { App, session } from "@daloyjs/core";

declare module "@daloyjs/core" {
  interface AppState {
    session: import("@daloyjs/core").SessionContext;
  }
}

const app = new App();

app.use(session({ secret: process.env.SESSION_SECRET! }));

app.route({
  method: "POST",
  path: "/login",
  operationId: "login",
  responses: { 200: { description: "ok" } },
  handler: async ({ state }) => {
    // After authenticating the user, rotate the id to defend against fixation
    // and write the user payload. Mutating ctx.state.session.data is enough -
    // the middleware persists changes once per request in onSend.
    await state.session.regenerate();
    state.session.set("userId", "u_123");
    return { status: 200 as const, body: { ok: true } };
  },
});

app.route({
  method: "GET",
  path: "/me",
  operationId: "me",
  responses: { 200: { description: "ok" } },
  handler: async ({ state }) => ({
    status: 200 as const,
    body: { userId: state.session.get<string>("userId") ?? null },
  }),
});

app.route({
  method: "POST",
  path: "/logout",
  operationId: "logout",
  responses: { 204: { description: "logged out" } },
  handler: async ({ state }) => {
    state.session.destroy();
    return { status: 204 as const };
  },
});`}
      />

      <h2>Defaults</h2>
      <p>
        Every option is conservative by default, with explicit error messages when a setting would
        silently weaken security (for example, a non-<code>/</code> path on a <code>__Host-</code>{" "}
        cookie or <code>SameSite=None</code> without <code>Secure</code>).
      </p>
      <ul>
        <li>
          <code>cookieName</code>: <code>__Host-daloy.sid</code> - forces <code>Secure</code>,{" "}
          <code>Path=/</code>, no <code>Domain</code>.
        </li>
        <li>
          <code>cookieOptions</code>: <code>{`{ secure: true, httpOnly: true, sameSite: "Lax", path: "/", maxAgeSeconds: 86_400 }`}</code>.
        </li>
        <li>
          <code>store</code>: a fresh <code>MemorySessionStore()</code> per app. Replace with a
          KV-backed store in production.
        </li>
        <li>
          <code>rolling</code>: <code>true</code> - every authenticated request slides the expiry
          and re-emits <code>Set-Cookie</code>.
        </li>
        <li>
          <code>saveUninitialized</code>: <code>false</code> - anonymous traffic that never touches
          the session never writes a cookie or store record.
        </li>
        <li>
          <code>generateId</code>: <code>crypto.randomUUID()</code> when available; otherwise a
          base64url-encoded 32-byte random string. Pass your own <code>generateId</code> to
          customize.
        </li>
      </ul>

      <h2>The session API</h2>
      <p>
        Inside a handler, <code>ctx.state.session</code> exposes:
      </p>
      <ul>
        <li>
          <code>id: string</code> - current session id.
        </li>
        <li>
          <code>data: Record&lt;string, unknown&gt;</code> - payload object. Mutating it through{" "}
          <code>set</code> / <code>delete</code> marks the session dirty and triggers a single store
          write in <code>onSend</code>.
        </li>
        <li>
          <code>get&lt;T&gt;(key)</code> / <code>set(key, value)</code> / <code>delete(key)</code>.
        </li>
        <li>
          <code>regenerate({`{ keepData? }`})</code> - issues a new id, destroys the previous store
          record, and (by default) carries the existing payload over. Call it on login and on
          privilege escalation to defend against session fixation.
        </li>
        <li>
          <code>destroy()</code> - drops server-side state and emits a <code>Set-Cookie</code> with{" "}
          <code>Max-Age=0</code>.
        </li>
      </ul>

      <h2>Key rotation</h2>
      <p>
        Pass an array to <code>secret</code>. The first entry is always used to sign new cookies;
        any later entry can verify (so older clients keep working until their next request) and
        triggers a transparent re-sign on the way out.
      </p>
      <CodeBlock code={`session({
  secret: [process.env.SESSION_SECRET_CURRENT!, process.env.SESSION_SECRET_PREVIOUS!],
});`}
      />

      <h2>Pluggable store</h2>
      <p>
        Implement <code>SessionStore</code> against any KV/Redis-shaped backend. Methods may return
        synchronously or via a <code>Promise</code> - DaloyJS always awaits them, so a fully async
        store works without changes.
      </p>
      <CodeBlock code={`import type { SessionStore } from "@daloyjs/core";

const kvStore: SessionStore = {
  async get(id) {
    const raw = await KV.get(id);
    return raw ? (JSON.parse(raw) as { data: Record<string, unknown>; expiresAt: number }) : null;
  },
  async set(id, record) {
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
    await KV.put(id, JSON.stringify(record), { expirationTtl: ttlSeconds });
  },
  async destroy(id) {
    await KV.delete(id);
  },
  // Optional: implement touch() to slide the expiry without rewriting the payload.
  async touch(id, expiresAt) {
    const raw = await KV.get(id);
    if (!raw) return;
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
    await KV.put(id, raw, { expirationTtl: ttlSeconds });
  },
};

app.use(session({ secret: process.env.SESSION_SECRET!, store: kvStore }));`}
      />

      <h2>Standalone signing helpers</h2>
      <p>
        The same HMAC-SHA256 primitives that power the cookie are exported as{" "}
        <code>signValue(value, secret)</code> and <code>verifySignedValue(signed, secret)</code>{" "}
        (which accepts a single secret or an array for rotation). Use them for ad-hoc cookies, magic
        links, or any other place you need a tamper-evident token without standing up the full
        session pipeline.
      </p>
      <CodeBlock code={`import { signValue, verifySignedValue } from "@daloyjs/core";

const signed = await signValue("user_123", process.env.LINK_SECRET!);
const original = await verifySignedValue(signed, process.env.LINK_SECRET!);
// original === "user_123" or null if tampered / wrong secret.`}
      />

      <h2>Security notes</h2>
      <ul>
        <li>
          The session cookie is <strong>HttpOnly</strong> by default - it is unreadable from
          JavaScript. Pair it with the <code>csrf()</code> middleware on mutating routes.
        </li>
        <li>
          Always rotate the id with <code>regenerate()</code> on login and privilege escalation.
        </li>
        <li>
          Use <code>destroy()</code> on logout to invalidate both the cookie and the store record.
        </li>
        <li>
          Treat the <code>secret</code> array as append-only: when you rotate, prepend the new key
          and keep the previous entry until the longest plausible session has expired.
        </li>
        <li>
          The default <code>MemorySessionStore</code> is per-process - it is suitable for tests and
          single-instance deployments only. Use a KV/Redis-shaped store across replicas.
        </li>
      </ul>
    </>
  );
}
