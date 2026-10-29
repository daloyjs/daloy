import type { Route } from "next";
import Link from "next/link";

import { LogoLockup } from "@/components/daloyjs-logo";
import { HTML_LANG, type SiteLocale } from "@/lib/i18n";

const COPYRIGHT_YEAR = 2026;

const linkClass = "underline underline-offset-4";

/** One footer link. `crossLocale` links reload the document (see lib/i18n). */
type FooterLink = {
  href: string;
  label: string;
  crossLocale?: boolean;
  hrefLang?: string;
  /** Set when the label itself is in another language (e.g. "Español"). */
  lang?: string;
};

const FOOTER_COPY: Record<
  SiteLocale,
  {
    home: string;
    homeLabel: string;
    license: string;
    distributed: string;
    links: FooterLink[];
  }
> = {
  en: {
    home: "/",
    homeLabel: "DaloyJS Home",
    license: "MIT licensed",
    distributed: "Distributed via",
    links: [
      { href: "/blog", label: "Blog" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/about-the-name", label: "About the name" },
      { href: "/es", label: "Español", crossLocale: true, hrefLang: HTML_LANG.es, lang: HTML_LANG.es },
    ],
  },
  es: {
    home: "/es",
    homeLabel: "Inicio de DaloyJS",
    license: "Licencia MIT",
    distributed: "Distribuido mediante",
    links: [
      { href: "/blog", label: "Blog (en inglés)", crossLocale: true, hrefLang: HTML_LANG.en },
      { href: "/es/docs", label: "Documentación" },
      { href: "/es/about", label: "Acerca de" },
      { href: "/es/contact", label: "Contacto" },
      { href: "/es/privacy", label: "Privacidad" },
      { href: "/es/about-the-name", label: "Sobre el nombre" },
      { href: "/", label: "English", crossLocale: true, hrefLang: HTML_LANG.en, lang: HTML_LANG.en },
    ],
  },
};

/**
 * Site-wide footer, rendered once per document by the root layout in the
 * request's locale.
 *
 * @param props.locale - Locale of the current document.
 */
export function SiteFooter({ locale }: { locale: SiteLocale }) {
  const copy = FOOTER_COPY[locale];

  return (
    <footer className="border-t px-6 py-6 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <Link href={copy.home as Route} aria-label={copy.homeLabel}>
            <LogoLockup className="h-6 w-auto transition-opacity hover:opacity-80" />
          </Link>
          <span className="hidden text-border sm:inline-block">|</span>
          <p className="text-center sm:text-left">
            {copy.license} · {copy.distributed}{" "}
            <a
              className="underline"
              href="https://pnpm.io/motivation"
              target="_blank"
              rel="noreferrer"
            >
              pnpm
            </a>
            {copy.links.map((link) => (
              <span key={link.href}>
                {" · "}
                {link.crossLocale ? (
                  <a
                    className={linkClass}
                    href={link.href}
                    hrefLang={link.hrefLang}
                    lang={link.lang}
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link className={linkClass} href={link.href as Route}>
                    {link.label}
                  </Link>
                )}
              </span>
            ))}
          </p>
        </div>
        <p className="text-center sm:text-right">
          <a className={linkClass} href="mailto:daloyjs@gmail.com">
            daloyjs@gmail.com
          </a>{" "}
          · © {COPYRIGHT_YEAR}{" "}
          {locale === "es" ? "colaboradores de DaloyJS" : "DaloyJS contributors"}
        </p>
      </div>
    </footer>
  );
}
