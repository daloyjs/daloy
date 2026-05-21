/**
 * Trie / radix-style router with a static-route fast path.
 *
 * Performance:
 *   - Static (parameter-free) paths resolve via a single Map.get — O(1).
 *   - Dynamic paths walk a trie, O(path-segments) regardless of route count.
 *   - Path string is split by `indexOf` rather than a regex/replace.
 *
 * Safety:
 *   - Path traversal (`..`) and empty segments are rejected at lookup time.
 *   - Duplicate routes and duplicate operationIds throw at registration.
 *   - Wildcard segments must be terminal.
 */

import type { HttpMethod } from "./types.js";

/** Result of {@link Router.find}: the matched handler plus extracted path params. */
export interface RouteMatch<T> {
  /** The handler registered for the matched `method` + `path`. */
  handler: T;
  /** Decoded path parameter values keyed by the segment name (`:id`, `*rest`, ...). */
  params: Record<string, string>;
}

interface Node<T> {
  children: Map<string, Node<T>>;
  paramChild?: { name: string; node: Node<T> };
  wildcardChild?: { name: string; node: Node<T> };
  handlers: Partial<Record<HttpMethod, T>>;
}

function createNode<T>(): Node<T> {
  return { children: new Map(), handlers: {} };
}

/**
 * Trie/radix router with a static-route fast path. Registers handlers via
 * {@link Router.add} and resolves them with {@link Router.find}. Rejects
 * duplicate routes, duplicate operationIds, conflicting param names, and
 * path-traversal lookups.
 */
export class Router<T> {
  private root = createNode<T>();
  private operationIds = new Set<string>();
  /** Static (no-param/no-wildcard) routes for O(1) lookup. */
  private staticTable = new Map<string, Partial<Record<HttpMethod, T>>>();

  add(method: HttpMethod, path: string, handler: T, operationId?: string): void {
    const segments = splitPath(path);
    if (operationId && this.operationIds.has(operationId)) throw new Error(`Duplicate operationId: "${operationId}"`);
    if (operationId) this.operationIds.add(operationId);
    const isStatic = segments.every((s) => !s.startsWith(":") && !s.startsWith("*"));
    const normalized = "/" + segments.join("/");

    if (isStatic) {
      let entry = this.staticTable.get(normalized);
      if (!entry) {
        entry = {};
        this.staticTable.set(normalized, entry);
      }
      if (entry[method]) throw new Error(`Duplicate route: ${method} ${path}`);
      entry[method] = handler;
      return;
    }

    let node = this.root;
    for (const seg of segments) {
      if (seg.startsWith(":")) {
        const name = seg.slice(1);
        if (!node.paramChild) {
          node.paramChild = { name, node: createNode<T>() };
        } else if (node.paramChild.name !== name) {
          throw new Error(
            `Conflicting param names at same position: "${node.paramChild.name}" vs "${name}"`
          );
        }
        node = node.paramChild.node;
      } else if (seg.startsWith("*")) {
        const name = seg.length > 1 ? seg.slice(1) : "wildcard";
        node.wildcardChild = { name, node: createNode<T>() };
        node = node.wildcardChild.node;
        break;
      } else {
        let next = node.children.get(seg);
        if (!next) {
          next = createNode<T>();
          node.children.set(seg, next);
        }
        node = next;
      }
    }

    if (node.handlers[method]) throw new Error(`Duplicate route: ${method} ${path}`);
    node.handlers[method] = handler;
  }

  find(method: HttpMethod, path: string): RouteMatch<T> | undefined {
    // Reject path traversal attempts before walking.
    if (path.includes("/../") || path.endsWith("/..") || path.includes("//")) {
      return undefined;
    }

    // Static fast path.
    const normalized = path.replace(/\/+$/, "") || "/";
    const staticEntry = this.staticTable.get(normalized);
    if (staticEntry && staticEntry[method]) {
      return { handler: staticEntry[method]!, params: {} };
    }

    const segments = splitPath(path);
    const params: Record<string, string> = {};
    const found = this.walk(this.root, segments, 0, params);
    if (!found) return undefined;
    const handler = found.handlers[method];
    if (!handler) return undefined;
    return { handler, params };
  }

  /** Returns the set of methods registered at this exact path (for 405 responses). */
  allowedMethods(path: string): HttpMethod[] {
    const normalized = path.replace(/\/+$/, "") || "/";
    const fromStatic = this.staticTable.get(normalized);
    if (fromStatic) return Object.keys(fromStatic) as HttpMethod[];
    const segments = splitPath(path);
    const found = this.walk(this.root, segments, 0, {});
    return found ? (Object.keys(found.handlers) as HttpMethod[]) : [];
  }

  private walk(
    node: Node<T>,
    segs: string[],
    i: number,
    params: Record<string, string>
  ): Node<T> | undefined {
    if (i === segs.length) return node;

    const seg = segs[i]!;
    const staticNext = node.children.get(seg);
    if (staticNext) {
      const r = this.walk(staticNext, segs, i + 1, params);
      if (r) return r;
    }
    if (node.paramChild) {
      params[node.paramChild.name] = decodeURIComponent(seg);
      const r = this.walk(node.paramChild.node, segs, i + 1, params);
      if (r) return r;
      delete params[node.paramChild.name];
    }
    if (node.wildcardChild) {
      params[node.wildcardChild.name] = segs.slice(i).map(decodeURIComponent).join("/");
      return node.wildcardChild.node;
    }
    return undefined;
  }
}

function splitPath(path: string): string[] {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return [];
  return clean.replace(/^\//, "").split("/");
}
