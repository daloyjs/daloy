/**
 * Trie / radix-style router with a static-route fast path.
 *
 * Performance:
 *   - Exact static (parameter-free) paths resolve via a Map lookup — O(1).
 *   - Dynamic paths walk a segment trie, visiting static branches before
 *     parameters and wildcards. Backtracking cost depends on overlapping routes.
 *   - Path normalization and splitting avoid regular expressions.
 *
 * Safety:
 *   - Raw `/../`, trailing `/..`, and empty segments are rejected at lookup time.
 *   - Decoded parameters are untrusted data, not sanitized filesystem paths.
 *   - Duplicate routes and duplicate operationIds throw at registration.
 *   - Wildcard segments must be terminal.
 */

import type { HttpMethod } from "./types.js";
import { isForbiddenObjectKey } from "./security.js";

/** Result of {@link Router.find}: the matched handler plus extracted path params. */
export interface RouteMatch<T> {
  /** The handler registered for the matched `method` + `path`. */
  handler: T;
  /** Decoded path parameter values keyed by the segment name (`:id`, `*rest`, ...). */
  params: Record<string, string>;
}

const handlerPrototype = Object.freeze(Object.create(null));

interface Node<T> {
  children: Map<string, Node<T>>;
  paramChild?: { name: string; node: Node<T> };
  wildcardChild?: { name: string; node: Node<T> };
  handlers?: Partial<Record<HttpMethod, T>>;
}

function createNode<T>(): Node<T> {
  return { children: new Map(), handlers: undefined };
}

/**
 * Trie/radix router with a static-route fast path. Registers handlers via
 * {@link Router.add} and resolves them with {@link Router.find}. Rejects
 * duplicate routes, duplicate operationIds, conflicting or unsafe capture names,
 * and raw path-traversal lookups.
 */
export class Router<T> {
  private root = createNode<T>();
  private operationIds = new Set<string>();
  private hasDynamicRoutes = false;
  private revision = 0;
  private staticMethods = new Map<
    string,
    { revision: number; methods: HttpMethod[] }
  >();
  /** Static (no-param/no-wildcard) routes for O(1) lookup. */
  private staticTable = new Map<string, Partial<Record<HttpMethod, T>>>();

  /**
   * Register a handler for the given method and path. Static paths land in the
   * O(1) `staticTable`; paths with `:param`/`*wildcard` segments are inserted
   * into the trie. Wildcards must be the terminal segment.
   *
   * @param method - HTTP method to register the handler under.
   * @param path - Route path; supports `:param` and a trailing `*wildcard`.
   * @param handler - Value returned by {@link Router.find} on a match, including
   *   falsy values or `undefined`.
   * @param operationId - Optional unique id; tracked to reject duplicates.
   * @throws Error on a duplicate route, duplicate `operationId`, or conflicting
   *   parameter or wildcard names at the same trie position, empty, repeated,
   *   or prototype-sensitive capture names, or a nonterminal wildcard.
   *   Failed registration does not reserve the `operationId`.
   */
  add(
    method: HttpMethod,
    path: string,
    handler: T,
    operationId?: string,
  ): void {
    const segments = splitPath(path);
    if (operationId && this.operationIds.has(operationId))
      throw new Error(`Duplicate operationId: "${operationId}"`);
    let captureNames: Set<string> | undefined;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      const wildcard = segment.startsWith("*");
      if (wildcard && index !== segments.length - 1) {
        throw new Error(`Wildcard must be the terminal segment: ${path}`);
      }
      if (wildcard || segment.startsWith(":")) {
        const name =
          wildcard && segment.length === 1 ? "wildcard" : segment.slice(1);
        if (!name || isForbiddenObjectKey(name) || captureNames?.has(name)) {
          throw new Error(
            `Invalid or duplicate capture name: "${name}" in ${path}`,
          );
        }
        (captureNames ??= new Set<string>()).add(name);
      }
    }
    const isStatic = captureNames === undefined;
    const normalized = "/" + segments.join("/");

    if (isStatic) {
      let entry = this.staticTable.get(normalized);
      if (!entry) {
        entry = Object.create(handlerPrototype) as Partial<
          Record<HttpMethod, T>
        >;
        this.staticTable.set(normalized, entry);
      }
      if (Object.hasOwn(entry, method))
        throw new Error(`Duplicate route: ${method} ${path}`);
      entry[method] = handler;
      this.revision++;
      if (operationId) this.operationIds.add(operationId);
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
            `Conflicting param names at same position: "${node.paramChild.name}" vs "${name}"`,
          );
        }
        node = node.paramChild.node;
      } else if (seg.startsWith("*")) {
        const name = seg.length > 1 ? seg.slice(1) : "wildcard";
        if (!node.wildcardChild) {
          node.wildcardChild = { name, node: createNode<T>() };
        } else if (node.wildcardChild.name !== name) {
          throw new Error(
            `Conflicting wildcard names at same position: "${node.wildcardChild.name}" vs "${name}"`,
          );
        }
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

    node.handlers ??= Object.create(handlerPrototype) as Partial<
      Record<HttpMethod, T>
    >;
    if (Object.hasOwn(node.handlers, method))
      throw new Error(`Duplicate route: ${method} ${path}`);
    node.handlers[method] = handler;
    this.hasDynamicRoutes = true;
    this.revision++;
    if (operationId) this.operationIds.add(operationId);
  }

  /**
   * Look up the handler registered for the given method and path. Tries the
   * static fast path first, then walks the trie, extracting and decoding path
   * params. Path-traversal lookups (`..`, `//`) are rejected up front.
   * Handler tables inherit only from an empty, frozen, prototype-free base:
   * Object.prototype properties never count as routes, including for untyped
   * runtime method values.
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
    if (staticEntry) {
      const handler = staticEntry[method];
      if (handler !== undefined || Object.hasOwn(staticEntry, method)) {
        return { handler: handler as T, params: {} };
      }
    }

    const segments = splitPath(path);
    const params: Record<string, string> = {};
    const found = this.walk(this.root, segments, 0, params);
    if (!found) return undefined;
    const handler = found.handlers![method];
    if (handler === undefined && !Object.hasOwn(found.handlers!, method))
      return undefined;
    return { handler: handler as T, params };
  }

  /**
   * Return the methods registered at the matched path for 405 responses.
   * Static-only routers skip trie traversal. Results are fresh arrays and
   * reflect routes registered after earlier lookups. Only validated registered
   * static paths are cached, bounding cache size by the static route count.
   * @param path - Request path, subject to the same traversal and empty-segment
   *   rejection as {@link Router.find}.
   * @returns Registered methods, or an empty array for rejected or unmatched paths.
   */
  allowedMethods(path: string): HttpMethod[] {
    const cached = this.staticMethods.get(path);
    if (cached?.revision === this.revision) return cached.methods.slice();
    if (path.includes("/../") || path.endsWith("/..") || path.includes("//")) {
      return [];
    }
    let fromStatic = this.staticTable.get(path);
    if (!fromStatic && path.endsWith("/")) {
      fromStatic = this.staticTable.get(trimTrailingSlashes(path));
    }
    const found = this.hasDynamicRoutes
      ? this.walk(this.root, splitPath(path), 0, {})
      : undefined;
    if (!fromStatic)
      return found ? (Object.keys(found.handlers!) as HttpMethod[]) : [];
    const methods = Object.keys(fromStatic) as HttpMethod[];
    if (found) {
      for (const method of Object.keys(found.handlers!) as HttpMethod[]) {
        if (!Object.hasOwn(fromStatic, method)) methods.push(method);
      }
    }
    this.staticMethods.set(trimTrailingSlashes(path), {
      revision: this.revision,
      methods,
    });
    return methods.slice();
  }

  private walk(
    node: Node<T>,
    segs: string[],
    i: number,
    params: Record<string, string>,
  ): Node<T> | undefined {
    if (i === segs.length) return node.handlers ? node : undefined;

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
