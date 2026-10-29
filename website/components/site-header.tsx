"use client";

import * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  ButterflyIcon,
  GithubLogoIcon,
  ListIcon,
  XLogoIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "./ui/button";
import { LogoMark } from "./daloyjs-logo";
import { NavLink } from "./nav-link";
import { ThemeSwitcher } from "./theme-switcher";
import { LanguageSwitcher } from "./language-switcher";
import { CORE_PACKAGE_VERSION } from "@/lib/seo";
import { HTML_LANG, localeFromPathname, type SiteLocale } from "@/lib/i18n";

type NavItem = { href: Route; label: string };

/**
 * Header copy per locale. A nav item whose target is in the other locale
 * (from Spanish: the blog and the untranslated docs) renders as a plain <a>
 * (a full document load, see lib/i18n.ts) marked `hreflang`.
 */
const NAV_COPY: Record<
  SiteLocale,
  {
    home: Route;
    items: NavItem[];
    installation: NavItem;
    openMenu: string;
    closeMenu: string;
    /** Tooltip on links that leave this locale. */
    otherLanguage?: string;
  }
> = {
  en: {
    home: "/",
    items: [
      { href: "/docs" as Route, label: "Docs" },
      { href: "/blog", label: "Blog" },
      { href: "/docs/getting-started" as Route, label: "Getting started" },
      { href: "/docs/tutorials/bookstore" as Route, label: "Tutorials" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/docs/installation" as Route, label: "Installation" },
    openMenu: "Open navigation menu",
    closeMenu: "Close navigation menu",
  },
  es: {
    home: "/es" as Route,
    items: [
      { href: "/es/docs" as Route, label: "Documentación" },
      { href: "/blog", label: "Blog" },
      { href: "/es/docs/getting-started" as Route, label: "Primeros pasos" },
      { href: "/es/docs/tutorials/bookstore" as Route, label: "Tutoriales" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/es/docs/installation" as Route, label: "Instalación" },
    openMenu: "Abrir el menú de navegación",
    closeMenu: "Cerrar el menú de navegación",
    otherLanguage: "Contenido en inglés",
  },
  zh: {
    home: "/zh" as Route,
    items: [
      { href: "/zh/docs" as Route, label: "文档" },
      { href: "/blog", label: "博客" },
      { href: "/zh/docs/getting-started" as Route, label: "快速开始" },
      { href: "/zh/docs/tutorials/bookstore" as Route, label: "教程" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/zh/docs/installation" as Route, label: "安装" },
    openMenu: "打开导航菜单",
    closeMenu: "关闭导航菜单",
    otherLanguage: "英文内容",
  },
  fr: {
    home: "/fr" as Route,
    items: [
      { href: "/fr/docs" as Route, label: "Documentation" },
      { href: "/blog", label: "Blog" },
      { href: "/fr/docs/getting-started" as Route, label: "Premiers pas" },
      { href: "/fr/docs/tutorials/bookstore" as Route, label: "Tutoriels" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/fr/docs/installation" as Route, label: "Installation" },
    openMenu: "Ouvrir le menu de navigation",
    closeMenu: "Fermer le menu de navigation",
    otherLanguage: "Contenu en anglais",
  },
  pt: {
    home: "/pt" as Route,
    items: [
      { href: "/pt/docs" as Route, label: "Documentação" },
      { href: "/blog", label: "Blog" },
      { href: "/pt/docs/getting-started" as Route, label: "Primeiros passos" },
      { href: "/pt/docs/tutorials/bookstore" as Route, label: "Tutoriais" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/pt/docs/installation" as Route, label: "Instalação" },
    openMenu: "Abrir o menu de navegação",
    closeMenu: "Fechar o menu de navegação",
    otherLanguage: "Conteúdo em inglês",
  },
  ar: {
    home: "/ar" as Route,
    items: [
      { href: "/ar/docs" as Route, label: "التوثيق" },
      { href: "/blog", label: "المدونة" },
      { href: "/ar/docs/getting-started" as Route, label: "البدء السريع" },
      { href: "/ar/docs/tutorials/bookstore" as Route, label: "دروس تعليمية" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/ar/docs/installation" as Route, label: "التثبيت" },
    openMenu: "فتح قائمة التنقل",
    closeMenu: "إغلاق قائمة التنقل",
    otherLanguage: "محتوى بالإنجليزية",
  },
  ru: {
    home: "/ru" as Route,
    items: [
      { href: "/ru/docs" as Route, label: "Документация" },
      { href: "/blog", label: "Блог" },
      { href: "/ru/docs/getting-started" as Route, label: "Быстрый старт" },
      { href: "/ru/docs/tutorials/bookstore" as Route, label: "Руководства" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/ru/docs/installation" as Route, label: "Установка" },
    openMenu: "Открыть меню навигации",
    closeMenu: "Закрыть меню навигации",
    otherLanguage: "Материалы на английском",
  },
  de: {
    home: "/de" as Route,
    items: [
      { href: "/de/docs" as Route, label: "Dokumentation" },
      { href: "/blog", label: "Blog" },
      { href: "/de/docs/getting-started" as Route, label: "Erste Schritte" },
      { href: "/de/docs/tutorials/bookstore" as Route, label: "Tutorials" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/de/docs/installation" as Route, label: "Installation" },
    openMenu: "Navigationsmenü öffnen",
    closeMenu: "Navigationsmenü schließen",
    otherLanguage: "Inhalt auf Englisch",
  },
  ja: {
    home: "/ja" as Route,
    items: [
      { href: "/ja/docs" as Route, label: "ドキュメント" },
      { href: "/blog", label: "ブログ" },
      { href: "/ja/docs/getting-started" as Route, label: "はじめに" },
      { href: "/ja/docs/tutorials/bookstore" as Route, label: "チュートリアル" },
      { href: "/docs/api-reference" as Route, label: "API" },
    ],
    installation: { href: "/ja/docs/installation" as Route, label: "インストール" },
    openMenu: "ナビゲーションメニューを開く",
    closeMenu: "ナビゲーションメニューを閉じる",
    otherLanguage: "英語のコンテンツ",
  },
};

const socialLinks = [
  {
    href: "https://x.com/daloyjs",
    label: "X",
    icon: XLogoIcon,
  },
  {
    href: "https://bsky.app/profile/daloyjs.dev",
    label: "Bluesky",
    icon: ButterflyIcon,
  },
  {
    href: "https://github.com/daloyjs/daloy",
    label: "GitHub",
    icon: GithubLogoIcon,
  },
];

/**
 * Sticky site header. Rendered once per document by the root layout.
 *
 * @param props.locale - Locale of the current document; picks the nav copy
 *   and the language switcher's target.
 */
export function SiteHeader({ locale }: { locale: SiteLocale }) {
  const copy = NAV_COPY[locale];
  const isCrossLocale = (href: string) => localeFromPathname(href) !== locale;
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const mobileNavButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const mobileNavPanelRef = React.useRef<HTMLDivElement | null>(null);
  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setMobileNavOpen(false);
    }
  });
  const handlePointerDown = React.useEffectEvent((event: PointerEvent) => {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    if (
      mobileNavPanelRef.current?.contains(target) ||
      mobileNavButtonRef.current?.contains(target)
    ) {
      return;
    }

    setMobileNavOpen(false);
  });

  React.useEffect(() => {
    if (!mobileNavOpen) {
      document.body.style.removeProperty("overflow");

      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mobileNavOpen]);

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-14 items-center gap-3">
          <Link
            href={copy.home}
            className="flex min-w-0 items-center gap-2 font-semibold"
          >
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground/4 ring-1 ring-foreground/10 dark:bg-white/5 dark:ring-white/10">
              <LogoMark className="size-5 text-sky-500" title="" />
            </span>
            <span className="truncate">
              Daloy<span className="text-sky-500 dark:text-sky-400">JS</span>
            </span>
            <span className="ms-1 hidden font-mono text-xs text-muted-foreground sm:inline-block">
              v{CORE_PACKAGE_VERSION}
            </span>
          </Link>

          <nav className="ms-8 hidden items-center gap-5 text-sm xl:flex">
            {copy.items.map((item) =>
              isCrossLocale(item.href) ? (
                <a
                  key={item.href}
                  href={item.href}
                  hrefLang={HTML_LANG[localeFromPathname(item.href)]}
                  title={copy.otherLanguage}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </a>
              ) : (
                <NavLink
                  key={item.href}
                  href={item.href}
                  exact
                  className={({ isActive }) =>
                    isActive
                      ? "font-medium text-foreground transition-colors"
                      : "text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher locale={locale} />
            <ThemeSwitcher />

            <div className="hidden items-center gap-2 xl:flex">
              {socialLinks.map((link) => {
                const Icon = link.icon;

                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={link.label}
                    onClick={closeMobileNav}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    <Icon className="size-4" />
                  </a>
                );
              })}
            </div>

            <div className="relative xl:hidden">
              {mobileNavOpen ? (
                <button
                  type="button"
                  aria-label={copy.closeMenu}
                  className="fixed inset-0 top-14 z-40 bg-background/40 backdrop-blur-[2px]"
                  onClick={closeMobileNav}
                />
              ) : null}

              <button
                ref={mobileNavButtonRef}
                type="button"
                aria-label={mobileNavOpen ? copy.closeMenu : copy.openMenu}
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-site-nav"
                className={
                  buttonVariants({ variant: "ghost", size: "sm" }) +
                  " mobile-nav__trigger relative z-50"
                }
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                <ListIcon className="size-4" />
              </button>

              <div
                id="mobile-site-nav"
                ref={mobileNavPanelRef}
                className={
                  "mobile-nav__panel absolute top-[calc(100%+0.5rem)] end-0 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur " +
                  (mobileNavOpen
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none -translate-y-2 scale-[0.98] opacity-0")
                }
              >
                <nav className="flex flex-col gap-1">
                  {[...copy.items, copy.installation].map((item) =>
                    isCrossLocale(item.href) ? (
                      <a
                        key={item.href}
                        href={item.href}
                        hrefLang={HTML_LANG[localeFromPathname(item.href)]}
                        title={copy.otherLanguage}
                        onClick={closeMobileNav}
                        className="rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <NavLink
                        key={item.href}
                        href={item.href}
                        exact={item !== copy.installation}
                        onClick={closeMobileNav}
                        className={({ isActive }) =>
                          isActive
                            ? "rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors"
                            : "rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                        }
                      >
                        {item.label}
                      </NavLink>
                    ),
                  )}
                </nav>

                <div className="mt-2 flex items-center gap-2 border-t border-border px-1 pt-2">
                  {socialLinks.map((link) => {
                    const Icon = link.icon;

                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={link.label}
                        onClick={closeMobileNav}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                      >
                        <Icon className="size-4" />
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
