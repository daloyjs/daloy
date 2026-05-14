import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Static sitemap for daloyjs.dev. Add new docs pages here so they are
 * discoverable by search engines.
 */
const STATIC_PATHS: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1.0 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.9 },
  { path: "/docs/installation", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/scaffolder", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/getting-started", changeFrequency: "monthly", priority: 0.9 },
  { path: "/docs/routing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/validation", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/plugins", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/errors", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/openapi", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/typed-client", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/security", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/adapters", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/deployment", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/testing", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/api-reference", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm", changeFrequency: "monthly", priority: 0.8 },
  { path: "/docs/orm/prisma", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/drizzle", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/typeorm", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/orm/supabase", changeFrequency: "monthly", priority: 0.7 },
  { path: "/docs/tutorials/bookstore", changeFrequency: "monthly", priority: 0.7 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return STATIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
