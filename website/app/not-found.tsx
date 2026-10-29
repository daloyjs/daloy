import Link from "next/link";
import type { Route } from "next";
import { headers } from "next/headers";

import { NotFoundSuggestions } from "@/components/not-found-suggestions";
import {
  LOCALE_HEADER,
  localeHome,
  localizedPath,
  parseLocaleHeader,
  translatedDocsIndex,
  type SiteLocale,
} from "@/lib/i18n";

const NOT_FOUND_COPY: Record<
  SiteLocale,
  { title: string; body: string; home: string; docs: string; sitemap: string; contact: string }
> = {
  en: {
    title: "Page not found",
    body: "That path does not exist on daloyjs.dev. If you followed a stale link, the sitemap, the agent index, and the docs home are the recovery paths.",
    home: "Home",
    docs: "Docs index",
    sitemap: "Sitemap",
    contact: "Contact",
  },
  es: {
    title: "Página no encontrada",
    body: "Esa ruta no existe en daloyjs.dev. Si has llegado desde un enlace antiguo, el mapa del sitio, el índice para agentes y el inicio de la documentación te ayudarán a encontrar lo que buscas.",
    home: "Inicio",
    docs: "Documentación en español",
    sitemap: "Mapa del sitio",
    contact: "Contacto",
  },
  zh: {
    title: "页面未找到",
    body: "daloyjs.dev 上不存在这个路径。如果你是通过过期的链接来到这里，可以从网站地图、面向智能体的索引或文档首页重新找到所需内容。",
    home: "首页",
    docs: "中文文档",
    sitemap: "网站地图",
    contact: "联系我们",
  },
  fr: {
    title: "Page introuvable",
    body: "Ce chemin n’existe pas sur daloyjs.dev. Si vous avez suivi un lien obsolète, le plan du site, l’index pour les agents et l’accueil de la documentation vous aideront à retrouver ce que vous cherchez.",
    home: "Accueil",
    docs: "Documentation en français",
    sitemap: "Plan du site",
    contact: "Contact",
  },
  pt: {
    title: "Página não encontrada",
    body: "Esse caminho não existe em daloyjs.dev. Se você seguiu um link antigo, o mapa do site, o índice para agentes e a página inicial da documentação ajudam a encontrar o que você procura.",
    home: "Início",
    docs: "Documentação em português",
    sitemap: "Mapa do site",
    contact: "Contato",
  },
  ar: {
    title: "الصفحة غير موجودة",
    body: "هذا المسار غير موجود على daloyjs.dev. إذا وصلت إلى هنا عبر رابط قديم، فإن خريطة الموقع وفهرس الوكلاء والصفحة الرئيسية للتوثيق ستساعدك على العثور على ما تبحث عنه.",
    home: "الرئيسية",
    docs: "التوثيق بالعربية",
    sitemap: "خريطة الموقع",
    contact: "اتصل بنا",
  },
  ru: {
    title: "Страница не найдена",
    body: "Такого пути на daloyjs.dev нет. Если вы перешли по устаревшей ссылке, найти нужное помогут карта сайта, индекс для агентов и главная страница документации.",
    home: "Главная",
    docs: "Документация на русском",
    sitemap: "Карта сайта",
    contact: "Контакты",
  },
  de: {
    title: "Seite nicht gefunden",
    body: "Diesen Pfad gibt es auf daloyjs.dev nicht. Wenn Sie einem veralteten Link gefolgt sind, helfen Ihnen die Sitemap, der Index für Agenten und die Startseite der Dokumentation weiter.",
    home: "Startseite",
    docs: "Dokumentation auf Deutsch",
    sitemap: "Sitemap",
    contact: "Kontakt",
  },
  ja: {
    title: "ページが見つかりません",
    body: "このパスは daloyjs.dev に存在しません。古いリンクからお越しの場合は、サイトマップ、エージェント向けインデックス、またはドキュメントのトップページから目的のページを探せます。",
    home: "ホーム",
    docs: "日本語ドキュメント",
    sitemap: "サイトマップ",
    contact: "お問い合わせ",
  },
};

/**
 * HTML 404 for browsers, in the language of the URL that missed (`/zh/...`
 * gets Chinese; proxy.ts derives the locale header from the pathname, so this
 * also works for paths that match no route). Agents that send
 * `Accept: text/markdown` are rewritten to `/md/...` in proxy.ts and receive
 * a Markdown recovery body instead, still with HTTP 404. JSON API clients
 * receive problem+json from `/api` and `/openapi.json`.
 */
export default async function NotFound() {
  const locale = parseLocaleHeader((await headers()).get(LOCALE_HEADER));
  const copy = NOT_FOUND_COPY[locale];
  const docs = locale === "en" ? "/docs" : translatedDocsIndex(locale);

  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16 lg:py-24">
        <p className="font-mono text-sm font-semibold tracking-widest text-sky-600 uppercase dark:text-sky-300">
          404
        </p>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-4 text-lg leading-8 text-muted-foreground">{copy.body}</p>
        </div>
        <NotFoundSuggestions />
        <ul className="list-disc space-y-2 ps-5 text-muted-foreground">
          <li>
            <Link className="underline underline-offset-4" href={localeHome(locale) as Route}>
              {copy.home}
            </Link>
          </li>
          <li>
            <Link className="underline underline-offset-4" href={docs as Route}>
              {copy.docs}
            </Link>
          </li>
          <li>
            <a className="underline underline-offset-4" href="/llms.txt">
              llms.txt
            </a>
          </li>
          <li>
            <a className="underline underline-offset-4" href="/sitemap.xml">
              {copy.sitemap}
            </a>
          </li>
          <li>
            <Link
              className="underline underline-offset-4"
              href={localizedPath("/contact", locale) as Route}
            >
              {copy.contact}
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
