import { CodeBlock } from "../../../components/code-block";

export const metadata = { title: "Plugins & encapsulation" };

export default function Page() {
  return (
    <>
      <h1>Plugins & encapsulation</h1>
      <p>
        Plugins package routes, hooks, and decorators into reusable units. Like Fastify, plugins are{" "}
        <strong>encapsulated</strong> — what happens inside a plugin stays inside, unless you opt out.
      </p>

      <h2>Defining a plugin</h2>
      <CodeBlock code={`import type { Plugin } from "daloy";

export const usersPlugin: Plugin = {
  name: "users",
  register(app) {
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
  hooks: {
    beforeHandle: [bearerAuth({ validate: t => t === process.env.TOKEN })],
  },
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
    </>
  );
}
