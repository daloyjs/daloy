"use client";

import * as React from "react";
import { CheckIcon, TranslateIcon } from "@phosphor-icons/react/ssr";

import { buttonVariants } from "@/components/ui/button";
import { useClientPathname } from "@/hooks/use-client-pathname";
import {
  HTML_LANG,
  LOCALE_NATIVE_NAME,
  localeHome,
  SITE_LOCALES,
  switchLocaleHref,
  type SiteLocale,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Button text and accessible name, in the current page's language. */
const SWITCH_COPY: Record<SiteLocale, { short: string; label: string }> = {
  en: { short: "EN", label: "Change language (current: English)" },
  es: { short: "ES", label: "Cambiar de idioma (actual: español)" },
  zh: { short: "中文", label: "切换语言（当前：简体中文）" },
  fr: { short: "FR", label: "Changer de langue (actuelle : français)" },
  pt: { short: "PT", label: "Mudar de idioma (atual: português)" },
};

function LanguageMenu({
  locale,
  pathname,
}: {
  locale: SiteLocale;
  pathname: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const menuId = React.useId();
  const copy = SWITCH_COPY[locale];

  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  });
  const handlePointerDown = React.useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
    setOpen(false);
  });

  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={copy.label}
        title={copy.label}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5")}
      >
        <TranslateIcon aria-hidden className="size-4" />
        <span className="font-mono text-xs font-semibold">{copy.short}</span>
      </button>
      <ul
        id={menuId}
        hidden={!open}
        className="absolute top-[calc(100%+0.5rem)] right-0 z-50 min-w-40 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur"
      >
        {SITE_LOCALES.map((target) => {
          const current = target === locale;
          // Before hydration (pathname null) every entry points at that
          // locale's home page; afterwards, at this page's counterpart.
          const href =
            pathname === null ? localeHome(target) : switchLocaleHref(pathname, target);
          return (
            <li key={target}>
              {/* A plain <a>, not next/link: switching locale must reload the
                  document so the root layout re-renders <html lang> and the
                  chrome (see lib/i18n.ts). */}
              <a
                href={href}
                hrefLang={HTML_LANG[target]}
                lang={HTML_LANG[target]}
                aria-current={current ? "true" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
                  current ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {LOCALE_NATIVE_NAME[target]}
                {current ? <CheckIcon aria-hidden className="size-3.5" /> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PathAwareLanguageMenu({ locale }: { locale: SiteLocale }) {
  return <LanguageMenu locale={locale} pathname={useClientPathname()} />;
}

/**
 * Header language menu: lists every locale by its native name and links to
 * the same page in that locale, or that locale's home page when the current
 * page has no translation.
 *
 * @param props.locale - Locale of the current document.
 */
export function LanguageSwitcher({ locale }: { locale: SiteLocale }) {
  return (
    <React.Suspense fallback={<LanguageMenu locale={locale} pathname={null} />}>
      <PathAwareLanguageMenu locale={locale} />
    </React.Suspense>
  );
}
