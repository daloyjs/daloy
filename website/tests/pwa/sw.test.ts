import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const swPath = path.join(process.cwd(), "public", "sw.js");

type FetchListener = (event: {
  request: { method: string; mode?: string; url: string };
  respondWith: (response: Promise<Response>) => void;
}) => void;

function requestKey(request: Request | string | { url: string }) {
  if (typeof request === "string") {
    return request;
  }

  return request.url;
}

function loadServiceWorker({
  fetchImpl = fetch,
  initialCache = new Map<string, Response>(),
}: {
  fetchImpl?: typeof fetch;
  initialCache?: Map<string, Response>;
} = {}) {
  const listeners = new Map<string, EventListener | FetchListener>();
  const cacheEntries = new Map(initialCache);
  const cache = {
    async addAll(requests: Request[]) {
      for (const request of requests) {
        cacheEntries.set(requestKey(request), new Response("precached"));
      }
    },
    async put(request: Request | { url: string }, response: Response) {
      cacheEntries.set(requestKey(request), response);
    },
  };
  const caches = {
    async open() {
      return cache;
    },
    async keys() {
      return ["daloyjs-pwa-v1", "daloyjs-pwa-v2"];
    },
    async delete() {
      return true;
    },
    async match(request: Request | string | { url: string }) {
      return cacheEntries.get(requestKey(request));
    },
  };
  const self = {
    location: { origin: "https://daloyjs.dev" },
    clients: { claim: async () => undefined },
    addEventListener(type: string, listener: EventListener | FetchListener) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
  };

  vm.runInNewContext(readFileSync(swPath, "utf8"), {
    Request,
    Response,
    URL,
    caches,
    fetch: fetchImpl,
    self,
  });

  return {
    cacheEntries,
    async fetch(request: { method: string; mode?: string; url: string }) {
      const listener = listeners.get("fetch") as FetchListener | undefined;
      assert.ok(listener, "expected a fetch listener");

      let responsePromise: Promise<Response> | undefined;
      listener({
        request,
        respondWith(response) {
          responsePromise = response;
        },
      });

      assert.ok(responsePromise, "expected fetch listener to call respondWith");

      return responsePromise;
    },
  };
}

test("service worker returns the offline page when navigation misses network and page cache", async () => {
  const offlineResponse = new Response("offline fallback", { status: 200 });
  const worker = loadServiceWorker({
    fetchImpl: async () => {
      throw new TypeError("offline");
    },
    initialCache: new Map([["/offline", offlineResponse]]),
  });

  const response = await worker.fetch({
    method: "GET",
    mode: "navigate",
    url: "https://daloyjs.dev/docs/routing",
  });

  assert.equal(await response.text(), "offline fallback");
});

test("service worker reuses a previously cached page when navigation is offline", async () => {
  const cachedResponse = new Response("cached docs page", { status: 200 });
  const worker = loadServiceWorker({
    fetchImpl: async () => {
      throw new TypeError("offline");
    },
    initialCache: new Map([
      ["https://daloyjs.dev/docs/routing", cachedResponse],
      ["/offline", new Response("offline fallback", { status: 200 })],
    ]),
  });

  const response = await worker.fetch({
    method: "GET",
    mode: "navigate",
    url: "https://daloyjs.dev/docs/routing",
  });

  assert.equal(await response.text(), "cached docs page");
});

test("service worker caches same-origin Next static assets after a network hit", async () => {
  const assetResponse = new Response("chunk", { status: 200 });
  const worker = loadServiceWorker({
    fetchImpl: async () => assetResponse,
  });
  const assetRequest = {
    method: "GET",
    url: "https://daloyjs.dev/_next/static/chunks/app.js",
  };

  const response = await worker.fetch(assetRequest);

  assert.equal(await response.text(), "chunk");
  assert.ok(worker.cacheEntries.has(assetRequest.url));
});
