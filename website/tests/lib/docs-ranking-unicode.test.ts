import { test } from "node:test";
import assert from "node:assert/strict";

import type { Route } from "next";

import { isUnspacedTerm, MAX_QUERY_TERMS, rankDocPages, tokenize } from "../../lib/docs-ranking";

const page = (href: string, title: string, description: string, body = "") => ({
  title,
  href: href as Route,
  description,
  keywords: [],
  body,
});

const PAGES = [
  page("/docs/installation", "Installation", "Install DaloyJS with pnpm", "pnpm add @daloyjs/core"),
  page("/es/docs/installation", "Instalación", "Instala DaloyJS con pnpm", "el periodo de espera reduce el riesgo"),
  page("/zh/docs/installation", "安装", "用 pnpm 安装 DaloyJS", "冷却期和 ignoreScripts 能降低供应链风险"),
  page("/docs/routing", "Routing", "Declare routes", "app.get(path, contract, handler)"),
];

test("tokenize keeps letters and digits in any script", () => {
  assert.deepEqual(tokenize("Instalación rápida"), ["instalación", "rápida"]);
  assert.deepEqual(tokenize("rate-limits v2"), ["rate", "limits", "v2"]);
});

test("tokenize splits Chinese runs into overlapping bigrams and keeps short runs whole", () => {
  assert.deepEqual(tokenize("如何安装"), ["如何", "何安", "安装"]);
  assert.deepEqual(tokenize("安装 DaloyJS"), ["安装", "daloyjs"]);
  assert.deepEqual(tokenize("安装daloyjs"), ["安装", "daloyjs"]);
  assert.deepEqual(tokenize("库"), ["库"]);
  assert.equal(isUnspacedTerm("安装"), true);
  assert.equal(isUnspacedTerm("instalación"), false);
});

test("tokenize rejects punctuation-only input and caps the term count", () => {
  assert.deepEqual(tokenize("!!! ... —— ，。"), []);
  assert.equal(tokenize(Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ")).length, MAX_QUERY_TERMS);
  assert.equal(tokenize("安装教程快速开始中文文档".repeat(20)).length <= MAX_QUERY_TERMS, true);
});

test("Chinese queries match Chinese titles and bodies as substrings", () => {
  assert.equal(rankDocPages(PAGES, "安装", 5)[0]?.page.href, "/zh/docs/installation");
  assert.equal(rankDocPages(PAGES, "供应链风险", 5)[0]?.page.href, "/zh/docs/installation");
  assert.deepEqual(rankDocPages(PAGES, "数据库迁移", 5), []);
});

test("accented Spanish queries match whole words", () => {
  assert.equal(rankDocPages(PAGES, "instalación", 5)[0]?.page.href, "/es/docs/installation");
});

test("English ranking is unchanged for ASCII queries", () => {
  assert.equal(rankDocPages(PAGES, "routing", 5)[0]?.page.href, "/docs/routing");
  assert.equal(rankDocPages(PAGES, "install", 5)[0]?.page.href, "/docs/installation");
});
