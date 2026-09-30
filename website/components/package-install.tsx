import type { ReactNode } from "react";

import { CodeBlock } from "./code-block";
import { PACKAGE_MANAGERS, type PackageManager } from "@/lib/package-managers";

import { PackageManagerTabs } from "./package-manager-tabs";

/** Props accepted by {@link PackageInstall}. */
export interface PackageInstallProps {
  /**
   * Space-separated packages to install, e.g. `"@daloyjs/core zod"`. Rendered
   * as `pnpm add …`, `npm install …`, `yarn add …` and `bun add …`.
   */
  packages?: string;
  /** Install as dev dependencies (`-D`). */
  dev?: boolean;
  /**
   * Explicit per-manager commands, for anything that is not a plain install
   * (e.g. `create`, `dlx`, running a script). Overrides `packages`.
   */
  commands?: Record<PackageManager, string>;
}

/**
 * Build the install command for each package manager.
 *
 * @param packages - Space-separated package specifiers.
 * @param dev - Whether to add them as dev dependencies.
 * @returns One command string per manager.
 */
export function installCommands(packages: string, dev = false): Record<PackageManager, string> {
  const list = packages.trim().split(/\s+/).join(" ");
  return {
    pnpm: `pnpm add ${dev ? "-D " : ""}${list}`,
    npm: `npm install ${dev ? "--save-dev " : ""}${list}`,
    yarn: `yarn add ${dev ? "--dev " : ""}${list}`,
    bun: `bun add ${dev ? "--dev " : ""}${list}`,
  };
}

/**
 * Package-manager tab set (pnpm / npm / yarn / bun) for install and CLI
 * commands. The reader's choice is remembered and applied to every tab set on
 * every page. Each panel is a server-highlighted {@link CodeBlock}.
 *
 * @example
 * <PackageInstall packages="@daloyjs/core zod" />
 * <PackageInstall commands={{ pnpm: "pnpm create daloy", npm: "npm create daloy@latest", yarn: "yarn create daloy", bun: "bun create daloy" }} />
 */
export function PackageInstall({ packages = "", dev = false, commands }: PackageInstallProps) {
  const resolved = commands ?? installCommands(packages, dev);
  const panels = Object.fromEntries(
    PACKAGE_MANAGERS.map((id) => [id, <CodeBlock key={id} code={resolved[id]} language="bash" className="my-0" />])
  ) as Record<PackageManager, ReactNode>;

  return <PackageManagerTabs panels={panels} />;
}
