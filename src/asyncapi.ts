/**
 * AsyncAPI 3.0 document generator for WebSocket surfaces.
 *
 * Built-in, dependency-free, and a deliberate mirror of the OpenAPI 3.1
 * generator in `./openapi.ts`: it turns every `app.ws()` route into an
 * AsyncAPI **channel** (the socket address + path parameters) and one or more
 * **operations** (`receive` for client→server messages, `send` for
 * server→client messages). The RFC 6455 stack and its CSWSH defenses finally
 * get a contract/doc artifact, extending the contract-first story past HTTP.
 *
 * If a message schema exposes a `toJSONSchema()` method (Zod 4, Valibot, ...)
 * we use it; otherwise we emit a permissive `{}` placeholder rather than fail
 * — docs and tooling still work, just with looser types for that payload.
 */

import type { App } from "./app.js";
import type { StandardSchemaV1 } from "./schema.js";
import type { WebSocketRouteEntry } from "./websocket.js";
import { openapiToYAML } from "./openapi.js";

/** AsyncAPI [Info Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#infoObject) header fields. */
export interface AsyncAPIInfo {
  /** Human-readable API title shown by AsyncAPI Studio / docs. */
  title: string;
  /** Semantic API version (independent of your package version). */
  version: string;
  /** Optional CommonMark long description rendered at the top of the docs. */
  description?: string;
}

/**
 * AsyncAPI [Server Object](https://www.asyncapi.com/docs/reference/specification/v3.0.0#serverObject).
 * Unlike OpenAPI's `servers` array, AsyncAPI keys servers by name.
 */
export interface AsyncAPIServer {
  /** Host (and optional port) the socket is reachable at, e.g. `api.example.com`. */
  host: string;
  /** Transport protocol, typically `ws` or `wss`. */
  protocol: string;
  /** Optional protocol version. */
  protocolVersion?: string;
  /** Optional base path prefixing channel addresses, e.g. `/realtime`. */
  pathname?: string;
  /** Optional human-readable server description. */
  description?: string;
}

/** Options for {@link generateAsyncAPI}. */
export interface AsyncAPIOptions {
  /** Required `info` block (title + version). */
  info: AsyncAPIInfo;
  /**
   * Optional named servers exposed in the document. AsyncAPI keys servers by
   * name (`{ production: { host, protocol } }`), not by an array.
   */
  servers?: Record<string, AsyncAPIServer>;
}

/**
 * Convert a Standard Schema to JSON Schema for an AsyncAPI message payload.
 *
 * Mirrors the OpenAPI generator's permissive strategy: use `toJSONSchema()`
 * when the schema exposes it (Zod 4, Valibot, ...), and otherwise fall back to
 * a permissive `{}` so generation never throws on an unconvertible schema.
 *
 * @param schema - The Standard Schema to convert, or `undefined`.
 * @returns A JSON-Schema-shaped object, or `undefined` when no schema given.
 */
function toPayloadSchema(schema: StandardSchemaV1 | undefined): unknown | undefined {
  if (!schema) return undefined;
  const anySchema = schema as { toJSONSchema?: () => unknown };
  if (typeof anySchema.toJSONSchema === "function") {
    try {
      return anySchema.toJSONSchema();
    } catch {
      /* fall through to permissive placeholder */
    }
  }
  return {};
}

/**
 * Derive a stable, unique channel/operation key from a WebSocket path.
 *
 * Strips the leading slash, drops `:param` / `{param}` markers, and camelCases
 * the remaining segments (`/chat/:room/feed` → `chatRoomFeed`). Falls back to
 * `root` for `/`. Collisions are de-duplicated by the caller.
 *
 * @param path - The registered WebSocket route path.
 * @returns A safe identifier base for AsyncAPI keys.
 */
function pathToKey(path: string): string {
  const segments = path
    .split("/")
    .map((s) => s.replace(/[:{}]/g, ""))
    .filter((s) => s.length > 0);
  if (segments.length === 0) return "root";
  return segments
    .map((seg, i) => {
      const clean = seg.replace(/[^A-Za-z0-9]+/g, " ").trim();
      const parts = clean.split(/\s+/).filter(Boolean);
      return parts
        .map((part, j) =>
          i === 0 && j === 0
            ? part.charAt(0).toLowerCase() + part.slice(1)
            : part.charAt(0).toUpperCase() + part.slice(1)
        )
        .join("");
    })
    .join("");
}

/**
 * Extract `:param` names from a WebSocket route path in declaration order.
 *
 * @param path - The registered WebSocket route path.
 * @returns The list of path-parameter names (without the leading colon).
 */
function extractParams(path: string): string[] {
  const names: string[] = [];
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)/g)) {
    names.push(match[1]!);
  }
  return names;
}

/**
 * Generate an AsyncAPI 3.0 document from a registered {@link App}'s WebSocket
 * routes.
 *
 * Every `app.ws()` route becomes one channel (its address + path parameters)
 * and one or more operations:
 *
 * - a `receive` operation for client→server messages — payload taken from the
 *   route's `meta.receive` schema, falling back to the handler's
 *   `request.body` schema (the same schema used for payload-size checks).
 * - a `send` operation for server→client messages — emitted only when the
 *   route declares a `meta.send` schema.
 *
 * The output is a plain JSON-serializable object: hand it to AsyncAPI Studio,
 * write it to disk for codegen, or serve it from a route. When the app has no
 * WebSocket routes the document still validates, with empty `channels` and
 * `operations` maps.
 *
 * @example
 * ```ts
 * import { generateAsyncAPI } from "@daloyjs/core/asyncapi";
 * import { writeFileSync } from "node:fs";
 *
 * const doc = generateAsyncAPI(app, {
 *   info: { title: "Realtime API", version: "1.0.0" },
 *   servers: { production: { host: "api.example.com", protocol: "wss" } },
 * });
 * writeFileSync("./generated/asyncapi.json", JSON.stringify(doc, null, 2));
 * ```
 *
 * @param app - The application whose WebSocket routes are documented.
 * @param options - Document metadata and optional named servers.
 * @returns A JSON-serializable AsyncAPI 3.0 document.
 * @since 0.37.0
 */
export function generateAsyncAPI(app: App, options: AsyncAPIOptions): Record<string, unknown> {
  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};

  const usedKeys = new Set<string>();
  const entries: WebSocketRouteEntry[] = app.webSocketRoutes.list();

  for (const entry of entries) {
    const path = entry.path;
    const meta = entry.handler.meta;

    // Derive a unique channel key (operationId override > path-derived slug).
    let key = meta?.operationId ?? pathToKey(path);
    if (usedKeys.has(key)) {
      let suffix = 2;
      while (usedKeys.has(`${key}${suffix}`)) suffix += 1;
      key = `${key}${suffix}`;
    }
    usedKeys.add(key);

    const address = path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const paramNames = extractParams(path);

    const channelMessages: Record<string, unknown> = {};

    // Inbound: a WebSocket route can always receive client messages, so a
    // `receive` operation is always emitted (permissive payload when no schema).
    const receiveSchema = meta?.receive ?? entry.handler.request?.body;
    const receiveMsgKey = `${key}Receive`;
    messages[receiveMsgKey] = {
      name: receiveMsgKey,
      title: `${key} inbound message`,
      payload: toPayloadSchema(receiveSchema) ?? {},
    };
    channelMessages.receiveMessage = {
      $ref: `#/components/messages/${receiveMsgKey}`,
    };
    operations[receiveMsgKey] = {
      action: "receive",
      channel: { $ref: `#/channels/${key}` },
      ...(meta?.summary ? { summary: meta.summary } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
      ...(meta?.tags ? { tags: meta.tags.map((t) => ({ name: t })) } : {}),
      messages: [{ $ref: `#/channels/${key}/messages/receiveMessage` }],
    };

    // Outbound: only emitted when the route declares an outbound schema.
    const sendSchema = meta?.send;
    if (sendSchema) {
      const sendMsgKey = `${key}Send`;
      messages[sendMsgKey] = {
        name: sendMsgKey,
        title: `${key} outbound message`,
        payload: toPayloadSchema(sendSchema) ?? {},
      };
      channelMessages.sendMessage = {
        $ref: `#/components/messages/${sendMsgKey}`,
      };
      operations[sendMsgKey] = {
        action: "send",
        channel: { $ref: `#/channels/${key}` },
        ...(meta?.summary ? { summary: meta.summary } : {}),
        ...(meta?.tags ? { tags: meta.tags.map((t) => ({ name: t })) } : {}),
        messages: [{ $ref: `#/channels/${key}/messages/sendMessage` }],
      };
    }

    const parameters: Record<string, unknown> = {};
    for (const name of paramNames) {
      parameters[name] = { description: `Path parameter \`${name}\`.` };
    }

    channels[key] = {
      address,
      ...(meta?.summary ? { summary: meta.summary } : {}),
      ...(meta?.description ? { description: meta.description } : {}),
      ...(paramNames.length ? { parameters } : {}),
      messages: channelMessages,
    };
  }

  return {
    asyncapi: "3.0.0",
    info: options.info,
    ...(options.servers ? { servers: options.servers } : {}),
    channels,
    operations,
    components: { messages },
  };
}

/**
 * Serialize an AsyncAPI document to YAML.
 *
 * Thin alias over the dependency-free YAML 1.2 emitter shared with the
 * OpenAPI generator ({@link openapiToYAML}) — AsyncAPI and OpenAPI documents
 * are both plain JSON-compatible objects, so the same emitter applies.
 *
 * @param doc - The AsyncAPI document produced by {@link generateAsyncAPI}.
 * @returns The document rendered as a YAML string.
 * @since 0.37.0
 */
export function asyncapiToYAML(doc: Record<string, unknown>): string {
  return openapiToYAML(doc);
}
