"use client";

import * as React from "react";

/**
 * Registers the PWA service worker in production, and actively tears it down
 * in development.
 *
 * The teardown matters: a service worker registered by an earlier production
 * run on the same origin (e.g. `next start` on localhost:3000) survives into
 * `next dev`, where its cache-first handling of `/_next/static` serves stale
 * chunks against Turbopack's fresh module graph. That surfaces as "module
 * factory is not available" runtime errors until the browser cache is cleared
 * manually. Unregistering and purging caches in dev makes the failure
 * impossible instead of relying on a hard reload.
 *
 * @returns Nothing; renders no UI.
 */
export function PwaServiceWorker() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations.map((registration) => registration.unregister()),
          ),
        )
        .then(() => ("caches" in window ? caches.keys() : []))
        .then((cacheNames) =>
          Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))),
        )
        .catch(() => {});
      return;
    }

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  return null;
}
