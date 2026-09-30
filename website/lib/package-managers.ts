/**
 * Package managers offered by the docs install tabs, in display order. Lives
 * outside the `"use client"` tab component so server components can import
 * the list as a plain value rather than a client reference.
 */
export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;

/** One of {@link PACKAGE_MANAGERS}. */
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
