/**
 * Trie / radix-style router with a static-route fast path.
 *
 * Performance:
 *   - Exact static (parameter-free) paths resolve via a Map lookup — O(1).
 *   - Dynamic paths walk a trie, O(path-segments) regardless of route count.
 *   - Path normalization and splitting avoid regular expressions.
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

  /**
   * Register a handler for the given method and path. Static paths land in the
   * O(1) `staticTable`; paths with `:param`/`*wildcard` segments are inserted
   * into the trie. Wildcards must be the terminal segment.
   *
   * @param method - HTTP method to register the handler under.
   * @param path - Route path; supports `:param` and a trailing `*wildcard`.
   * @param handler - Value returned by {@link Router.find} on a match.
   * @param operationId - Optional unique id; tracked to reject duplicates.
   * @throws Error on a duplicate route, duplicate `operationId`, or conflicting
   *   param names at the same trie position.
   */
  add(method: HttpMethod, path: string, handler: T, operationId?: string): void {
    const segments = splitPath(path);
    if (operationId && this.operationIds.has(operationId))
      throw new Error(`Duplicate operationId: "${operationId}"`);
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

  /**
   * Look up the handler registered for the given method and path. Tries the
   * static fast path first, then walks the trie, extracting and decoding path
   * params. Path-traversal lookups (`..`, `//`) are rejected up front.
   *
   * @param method - HTTP method to match.
   * @param path - Request path to resolve, including any dynamic segments.
   * @returns The matched handler with decoded params, or `undefined` if no
   *   route matches the method + path.
   */
  find(method: HttpMethod, path: string): RouteMatch<T> | undefined {
    // Reject path traversal attempts before walking.
    if (path.includes("/../") || path.endsWith("/..") || path.includes("//")) {
      return undefined;
    }

    // Static fast path. Avoid allocating a normalized string for the common
    // exact-path case; only trim when a trailing slash is actually present.
    let staticEntry = this.staticTable.get(path);
    if (!staticEntry && path.endsWith("/")) {
      staticEntry = this.staticTable.get(trimTrailingSlashes(path));
    }
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
    let fromStatic = this.staticTable.get(path);
    if (!fromStatic && path.endsWith("/")) {
      fromStatic = this.staticTable.get(trimTrailingSlashes(path));
    }
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
      const decoded = safeDecodeURIComponent(seg);
      if (decoded !== undefined) {
        params[node.paramChild.name] = decoded;
        const r = this.walk(node.paramChild.node, segs, i + 1, params);
        if (r) return r;
        delete params[node.paramChild.name];
      }
    }
    if (node.wildcardChild) {
      const rest = decodeSegments(segs, i);
      if (rest !== undefined) {
        params[node.wildcardChild.name] = rest;
        return node.wildcardChild.node;
      }
    }
    return undefined;
  }
}

/**
 * Decode a single path segment, returning `undefined` instead of throwing when
 * the segment contains a malformed percent-escape (e.g. `%zz` or a lone `%`).
 * A malformed segment therefore fails to match and yields a clean 404 rather
 * than letting a `URIError` bubble up as a generic 500.
 */
function safeDecodeURIComponent(segment: string): string | undefined {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Decode and join the wildcard tail starting at `index`. Returns `undefined`
 * if any captured segment carries a malformed percent-escape, so the lookup
 * misses cleanly instead of throwing.
 */
function decodeSegments(segs: string[], index: number): string | undefined {
  const parts: string[] = [];
  for (let i = index; i < segs.length; i++) {
    const decoded = safeDecodeURIComponent(segs[i]!);
    if (decoded === undefined) return undefined;
    parts.push(decoded);
  }
  return parts.join("/");
}

function trimTrailingSlashes(path: string): string {
  if (path.length === 0) return "/";
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  return end === path.length ? path : path.slice(0, end);
}

function splitPath(path: string): string[] {
  const clean = trimTrailingSlashes(path);
  if (clean === "/") return [];
  return (clean.charCodeAt(0) === 47 ? clean.slice(1) : clean).split("/");
}
