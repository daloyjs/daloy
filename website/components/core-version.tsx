import { CORE_PACKAGE_VERSION } from "@/lib/seo";

/**
 * The current `@daloyjs/core` version (from `CORE_PACKAGE_VERSION`), for use
 * inside docs prose, e.g. "DaloyJS v<CoreVersion />". Exists so MDX pages,
 * which cannot import modules, can still show the live version number.
 */
export function CoreVersion() {
  return <>{CORE_PACKAGE_VERSION}</>;
}
