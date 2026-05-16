import { CodeBlock } from "../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Plugins & encapsulation",
  description:
    "Compose DaloyJS apps with encapsulated plugins — scoped middleware, decorators, and route prefixes — for large-scale, maintainable TypeScript services.",
  path: "/docs/plugins",
  keywords: ["DaloyJS plugins", "plugin encapsulation", "middleware composition", "scalable TypeScript framework"],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Plugins & encapsulation</h1>
      <p>
        Plugins package routes, hooks, and decorators into reusable units. Like Fastify, plugins are{" "}
        <strong>encapsulated</strong> — what happens inside a plugin stays inside, unless you opt out.
      </p>

      <h2>Defining a plugin</h2>
      <p>
        A plugin is any object with an optional <code>name</code> and a <code>register(app)</code>{" "}
        function — or a plain function with the same shape. No imports required.
      </p>
      <CodeBlock code={`import type { App } from "@daloyjs/core";

export const usersPlugin = {
  name: "users",
  register(app: App) {
    app.use(/* plugin-scoped middleware */);

    app.route({
      method: "GET",
      path: "/me",
      operationId: "me",
      responses: { 200: { description: "current user" } },
      handler: async () => ({ status: 200, body: { user: "alice" } }),
    });
  },
};`} />

      <h2>Registering a plugin</h2>
      <CodeBlock code={`app.register(usersPlugin, {
  prefix: "/users",
  tags: ["Users"],
  hooks: bearerAuth({ validate: t => t === process.env.TOKEN }),
});

await app.ready();`} />

      <h2>Decorators</h2>
      <p>
        Decorate your app to inject shared resources into every handler&apos;s <code>state</code>:
      </p>
      <CodeBlock code={`app.decorate("db", await openDatabase());
app.decorate("logger", createLogger({ level: "info" }));

app.route({
  method: "GET",
  path: "/items/:id",
  operationId: "getItem",
  responses: { 200: { description: "ok" } },
  handler: async ({ params, state }) => {
    const row = await state.db.findOne("items", { id: params.id });
    state.logger.info({ id: params.id }, "item fetched");
    return { status: 200, body: row };
  },
});`} />

      <h2>Why encapsulation matters</h2>
      <ul>
        <li>You can mount the same plugin twice under different prefixes without bleed-through.</li>
        <li>Third-party plugins can&apos;t accidentally rewrite your error handler or hooks.</li>
        <li>Plugin-internal middleware doesn&apos;t apply to sibling routes — predictable order.</li>
      </ul>

      <h2>Lifecycle events</h2>
      <p>
        Observability plugins often need to know when other plugins finish installing or when the
        process starts shutting down. DaloyJS exposes two event hooks for this without polluting the
        route registry:
      </p>
      <ul>
        <li>
          <code>app.onPluginInstalled(listener)</code> — fires once per <code>register()</code> call,
          after sync plugins return and after async plugins resolve. The listener receives{" "}
          <code>{`{ name?: string, prefix: string }`}</code>, where <code>prefix</code> is the
          effective mounted prefix after nesting. Awaiting <code>app.ready()</code> drains
          both async plugins and async listeners.
        </li>
        <li>
          <code>app.onShutdown(listener)</code> — fires at the start of{" "}
          <code>app.shutdown(timeoutMs, reason)</code>, <em>before</em> in-flight requests drain. Use
          this to flush metrics, publish a &ldquo;draining&rdquo; signal to a load balancer, or close
          background pollers. For post-drain cleanup (database pools, file handles), keep using{" "}
          <code>onClose()</code>.
        </li>
      </ul>
      <CodeBlock code={`app.onPluginInstalled((info) => {
  metrics.counter("plugin.installed", { name: info.name ?? "anonymous", prefix: info.prefix });
});

app.onShutdown(async ({ reason, timeoutMs }) => {
  await loadBalancer.drain({ timeoutMs });
  metrics.counter("app.shutdown", { reason: reason ?? "unknown" });
});

app.onClose(async () => {
  await db.close();
});

app.register(usersPlugin, { prefix: "/users" });
await app.ready();

// later, on SIGTERM
await app.shutdown(10_000, "SIGTERM");`} />
      <p>
        Listener errors are caught and logged via the configured logger so a faulty observer can
        never block plugin registration or graceful shutdown. Both <code>shutdown()</code> and the
        underlying <code>onClose</code> chain remain idempotent.
      </p>
    </>
  );
}
