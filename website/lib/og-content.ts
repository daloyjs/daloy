import type { Route } from "next";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getAllDocPages, getDocPage } from "@/lib/docs-content";

export type OgPageContent = {
  title: string;
  description: string;
  path: string;
};

const blogDir = path.join(process.cwd(), "app", "blog");

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isSafeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function parseStringProperty(source: string, key: string): string | null {
  const match = new RegExp(`${key}:\\s*`).exec(source);
  if (!match) return null;

  let index = match.index + match[0].length;
  while (/\s/.test(source[index] ?? "")) index += 1;

  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  let escaped = false;
  let value = "";

  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor] ?? "";

    if (escaped) {
      value += `\\${char}`;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      return normalizeText(decodeStringEscapes(value));
    }

    value += char;
  }

  return null;
}

function decodeStringEscapes(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function readBlogPostPage(slug: string): Promise<string | null> {
  if (!isSafeSlug(slug)) return null;

  try {
    return await readFile(path.join(blogDir, slug, "page.tsx"), "utf8");
  } catch {
    return null;
  }
}

export async function getAllBlogPostOgContent(): Promise<OgPageContent[]> {
  const entries = await readdir(blogDir, { withFileTypes: true });
  const posts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isSafeSlug(entry.name))
      .map((entry) => getBlogPostOgContent(entry.name)),
  );

  return posts.filter((post): post is OgPageContent => post !== null);
}

export async function getBlogPostOgContent(slug: string): Promise<OgPageContent | null> {
  const source = await readBlogPostPage(slug);
  if (!source) return null;

  return {
    title: parseStringProperty(source, "title") ?? titleFromSlug(slug),
    description:
      parseStringProperty(source, "description") ??
      "A DaloyJS field note from the framework blog.",
    path: `/blog/${slug}`,
  };
}

export async function getAllDocOgContent(): Promise<OgPageContent[]> {
  const pages = await getAllDocPages();

  return pages.map((page) => ({
    title: page.title,
    description: page.description,
    path: page.href,
  }));
}

export async function getDocOgContent(route: string): Promise<OgPageContent | null> {
  const page = await getDocPage(route);
  if (!page) return null;

  return {
    title: page.title,
    description: page.description,
    path: page.href,
  };
}

export function docPathFromSlug(slug: string[]): Route {
  return slug.length === 0 ? "/docs" : (`/docs/${slug.join("/")}` as Route);
}
