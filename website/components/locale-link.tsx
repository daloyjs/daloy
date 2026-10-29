import type { ComponentProps } from "react";
import type { Route } from "next";
import Link from "next/link";

import { HTML_LANG, localeFromPathname, type SiteLocale } from "@/lib/i18n";

type LocaleLinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  /** Locale of the page rendering the link. */
  locale: SiteLocale;
};

/**
 * Internal link that respects the locale boundary: a same-locale target uses
 * `next/link`, a target in the other locale (for example the English docs
 * from a Spanish page) is a plain `<a hreflang>` so the document reloads and
 * the root layout re-renders `<html lang>` and the chrome (see lib/i18n.ts).
 *
 * @param props.href - Site-absolute path, optionally with `#hash`.
 * @param props.locale - Locale of the current page.
 */
export function LocaleLink({ href, locale, ...rest }: LocaleLinkProps) {
  const target = localeFromPathname(href.split(/[?#]/, 1)[0] ?? href);
  if (target !== locale) {
    return <a href={href} hrefLang={HTML_LANG[target]} {...rest} />;
  }
  return <Link href={href as Route} {...rest} />;
}
