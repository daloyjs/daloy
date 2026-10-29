"use client";

import { Suspense } from "react";
import { TranslateIcon } from "@phosphor-icons/react/ssr";

import { buttonVariants } from "@/components/ui/button";
import { useClientPathname } from "@/hooks/use-client-pathname";
import {
  HTML_LANG,
  SPANISH_ROOT,
  switchLocaleHref,
  type SiteLocale,
} from "@/lib/i18n";

const SWITCH_COPY: Record<
  SiteLocale,
  { target: SiteLocale; short: string; label: string; fallback: string }
> = {
  // Each label is written in the target language, so it is readable by the
  // person who needs it and announced with the right `lang`.
  en: {
    target: "es",
    short: "ES",
    label: "Leer en español (España)",
    fallback: SPANISH_ROOT,
  },
  es: {
    target: "en",
    short: "EN",
    label: "Read in English",
    fallback: "/",
  },
};

function SwitchLink({ locale, href }: { locale: SiteLocale; href: string }) {
  const copy = SWITCH_COPY[locale];
  const lang = HTML_LANG[copy.target];

  // A plain <a>, not next/link: switching locale must reload the document so
  // the root layout re-renders <html lang>, the header and the footer.
  return (
    <a
      href={href}
      hrefLang={lang}
      lang={lang}
      aria-label={copy.label}
      title={copy.label}
      className={buttonVariants({ variant: "ghost", size: "sm" }) + " gap-1.5"}
    >
      <TranslateIcon className="size-4" />
      <span className="font-mono text-xs font-semibold">{copy.short}</span>
    </a>
  );
}

function PathAwareSwitchLink({ locale }: { locale: SiteLocale }) {
  const pathname = useClientPathname();
  const copy = SWITCH_COPY[locale];
  const href =
    pathname === null ? copy.fallback : switchLocaleHref(pathname, copy.target);
  return <SwitchLink locale={locale} href={href} />;
}

/**
 * Header link to the same page in the other locale (or that locale's home
 * page when the current page has no translation). Before hydration it points
 * at the other locale's home page.
 *
 * @param props.locale - Locale of the current document.
 */
export function LanguageSwitcher({ locale }: { locale: SiteLocale }) {
  return (
    <Suspense
      fallback={<SwitchLink locale={locale} href={SWITCH_COPY[locale].fallback} />}
    >
      <PathAwareSwitchLink locale={locale} />
    </Suspense>
  );
}
