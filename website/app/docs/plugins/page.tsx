import { CodeBlock } from "../../../components/code-block";
import { BranchDiagram } from "../../../components/diagram";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Plugins & encapsulation",
  description:
    "Compose DaloyJS apps with encapsulated plugins, scoped middleware, decorators, lifecycle hooks, and route prefixes, for large-scale, maintainable TypeScript services.",
  path: "/docs/plugins",
  keywords: [
    "DaloyJS plugins",
    "plugin encapsulation",
    "middleware composition",
    "plugin lifecycle",
    "scalable TypeScript framework",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Plugins &amp; encapsulation</h1>
      <p>
        Plugins package routes, hooks, decorators, and lifecycle callbacks into
        reusable units. Like Fastify, DaloyJS gives each plugin a local scope:
        app-level hooks and decorators flow inward, while plugin-level hooks and
        decorators do not leak sideways to sibling plugins.
      </p>

      <BranchDiagram
        title="Plugin encapsulation"
        source={{
          eyebrow: "app.register(...)",
          label: "App",
          detail: "global hooks + decorators flow inward",
        }}
        branches={[
          {
            eyebrow: "prefix /users",
            label: "users plugin",
            detail: "scoped hooks · routes · decorators",
          },
          {
            eyebrow: "prefix /billing",
            label: "billing plugin",
            detail: "scoped hooks · routes · decorators",
          },
          {
            eyebrow: "prefix /admin",
            label: "admin plugin",
            detail: "scoped hooks · routes · decorators",
          },
        ]}
        caption="Each plugin gets its own child App. Routes inherit the prefix, tags, hooks, auth, and app-level decorators, but hooks and decorators added inside one plugin apply only to that plugin's routes."
      />

      <h2 id="defining-a-plugin">Defining a plugin</h2>
      <p>
        A plugin can be a descriptor object with optional metadata and a{" "}
        <code>register(app)</code> function, or a plain function that receives
        the child app. Name plugins that manage shared state so DaloyJS can
        deduplicate them and validate dependencies.
      </p>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { z } from "zod";

const CurrentUser = z.object({
  user: z.string(),
});

export const usersPlugin = {
  name: "users",
  register(app: App) {
    app.use({
      beforeHandle(ctx) {
        ctx.set.headers.set("x-plugin", "users");
      },
    });

    app.route({
      method: "GET",
      path: "/me",
      operationId: "me",
      responses: {
        200: { description: "Current user", body: CurrentUser },
      },
      handler: async () => ({
        status: 200,
        body: { user: "alice" },
      }),
    });
  },
};`}
      />

      <h2 id="registering-a-plugin">Registering a plugin</h2>
      <p>
        <code>app.register()</code> mounts the plugin in a scoped group. The
        registration config supplies the inherited prefix, tags, hooks, and
        route auth metadata for every route the plugin adds.
      </p>
      <CodeBlock
        code={`import { App, bearerAuth } from "@daloyjs/core";

const app = new App();

app.register(usersPlugin, {
  prefix: "/users",
  tags: ["Users"],
  hooks: bearerAuth({
    validate: (token) => token === process.env.USERS_TOKEN,
  }),
  auth: { scheme: "bearer" },
});

await app.ready();`}
      />
      <p>
        Await <code>app.ready()</code> before starting the server whenever a
        plugin does async work. Sync plugins also use the same queue for async
        install observers, so it is safe to call every time.
      </p>

      <h2 id="dependencies-seeds-and-state">Dependencies, seeds, and state</h2>
      <p>
        Plugin descriptors can declare operational metadata that DaloyJS checks
        at registration time:
      </p>
      <ul>
        <li>
          <code>dependencies</code>: prerequisite plugin names that must already
          be registered.
        </li>
        <li>
          <code>seed</code>: a differentiator for mounting the same named plugin
          more than once with different configuration.
        </li>
        <li>
          <code>stateful</code>: production guard for plugins that mutate shared
          state. Anonymous stateful plugins are refused unless you give them a
          name.
        </li>
      </ul>
      <CodeBlock
        code={`app.register({
  name: "redis-connection",
  stateful: true,
  register(app) {
    app.decorate("redis", redis);
  },
});

app.register({
  name: "rate-limit-cluster",
  dependencies: ["redis-connection"],
  register(app) {
    app.use(rateLimitWithRedis());
  },
});

app.register({ name: "metrics", seed: "public", register: publicMetrics });
app.register({ name: "metrics", seed: "admin", register: adminMetrics });

// This fails because "metrics#public" is already installed.
app.register({ name: "metrics", seed: "public", register: publicMetrics });`}
      />

      <h2 id="decorators">Decorators</h2>
      <p>
        Decorate the app to inject shared resources into every handler&apos;s{" "}
        <code>state</code>. Decorations added at the root are visible inside
        plugins. Decorations added inside a plugin stay scoped to that plugin
        and never leak sideways to sibling plugins or back up to the root.
        Reusing a key throws unless you pass <code>{`{ override: true }`}</code>
        deliberately.
      </p>
      <p>
        Each route binds to its scope&apos;s decorations when it is registered,
        so <strong>decorate before registering the routes that read it</strong>{" "}
        (the same ordering Fastify requires). Declare root-level decorations
        before the plugins and groups that depend on them, and a plugin&apos;s
        own decorations before that plugin&apos;s routes.
      </p>
      <CodeBlock
        code={`import { z } from "zod";

const Item = z.object({
  id: z.string(),
  name: z.string(),
});

app.decorate("db", await openDatabase());
app.decorate("logger", createLogger({ level: "info" }));

app.route({
  method: "GET",
  path: "/items/:id",
  operationId: "getItem",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: "Item", body: Item },
    404: { description: "Not found" },
  },
  handler: async ({ params, state }) => {
    const row = await state.db.findOne("items", { id: params.id });
    state.logger.info({ id: params.id }, "item fetched");
    return { status: 200, body: row };
  },
});`}
      />

      <h2 id="extension-ordering">Extension ordering</h2>
      <p>
        Plugins that contribute lifecycle hooks can declare ordered extensions.
        DaloyJS topologically sorts <code>before</code> and <code>after</code>{" "}
        relationships, rejects duplicate extension names, and refuses two
        extensions that mutate the same response header without an explicit
        order.
      </p>
      <CodeBlock
        code={`import type { PluginExtension } from "@daloyjs/core";

const extensions: PluginExtension[] = [
  {
    name: "trace-id",
    event: "onSend",
    responseHeaders: ["x-trace-id"],
    handler(res) {
      res.headers.set("x-trace-id", crypto.randomUUID());
    },
    before: ["security-headers"],
  },
  {
    name: "security-headers",
    event: "onSend",
    responseHeaders: ["x-content-type-options"],
    handler(res) {
      res.headers.set("x-content-type-options", "nosniff");
    },
  },
];

app.register({ name: "observability", extensions });`}
      />

      <h2 id="why-encapsulation-matters">Why encapsulation matters</h2>
      <ul>
        <li>
          You can mount the same plugin twice under different prefixes without
          hook bleed-through.
        </li>
        <li>
          Third-party plugins cannot accidentally rewrite sibling hooks or error
          handlers.
        </li>
        <li>
          Prefixes, tags, hooks, auth, and decorators stay predictable as a
          service grows.
        </li>
        <li>
          Named stateful plugins are deduplicated, and dependencies fail fast
          when the registration order is wrong.
        </li>
      </ul>

      <h2 id="lifecycle-events">Lifecycle events</h2>
      <p>
        Observability plugins often need to know when other plugins finish
        installing or when the process starts shutting down. DaloyJS exposes two
        event hooks for this without polluting the route registry:
      </p>
      <ul>
        <li>
          <code>app.onPluginInstalled(listener)</code>: fires once per{" "}
          <code>register()</code> call, after sync plugins return and after
          async plugins resolve. The listener receives{" "}
          <code>{`{ name?: string, prefix: string }`}</code>, where{" "}
          <code>prefix</code> is the effective mounted prefix after nesting.
          Awaiting <code>app.ready()</code> drains async plugins and async
          listeners.
        </li>
        <li>
          <code>app.onShutdown(listener)</code>: fires at the start of{" "}
          <code>app.shutdown(timeoutMs, reason)</code>, before in-flight
          requests drain. Use this to flush metrics, publish a draining signal
          to a load balancer, or close background pollers. For post-drain
          cleanup such as database pools and file handles, keep using{" "}
          <code>onClose()</code>.
        </li>
      </ul>
      <CodeBlock
        code={`app.onPluginInstalled((info) => {
  metrics.counter("plugin.installed", {
    name: info.name ?? "anonymous",
    prefix: info.prefix,
  });
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

// Later, on SIGTERM:
await app.shutdown(10_000, "SIGTERM");`}
      />
      <p>
        Listener errors are caught and logged via the configured logger so a
        faulty observer does not crash plugin registration or graceful shutdown.
        Both <code>shutdown()</code> and the underlying <code>onClose</code>{" "}
        chain remain idempotent.
      </p>
    </>
  );
}
