"use client";

import * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  ButterflyIcon,
  GithubLogoIcon,
  ListIcon,
  PackageIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import { buttonVariants } from "./ui/button";
import { ThemeSwitcher } from "./theme-switcher";
import { CORE_PACKAGE_VERSION } from "@/lib/seo";

const primaryNav: Array<{ href: Route; label: string }> = [
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/docs/getting-started", label: "Getting started" },
  { href: "/docs/tutorials/bookstore", label: "Tutorials" },
  { href: "/docs/api-reference", label: "API" },
];

const socialLinks = [
  {
    href: "https://x.com/daloyjs",
    label: "X",
    icon: XIcon,
  },
  {
    href: "https://bsky.app/profile/daloyjs.dev",
    label: "Bluesky",
    icon: ButterflyIcon,
  },
  {
    href: "https://github.com/daloyjs",
    label: "GitHub",
    icon: GithubLogoIcon,
  },
];

export function SiteHeader() {
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
    <header
      className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60"
      style={{ viewTransitionName: "site-header" }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-14 items-center gap-3">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 font-semibold"
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              dj
            </span>
            <span className="truncate">DaloyJS</span>
            <span className="ml-1 hidden font-mono text-xs text-muted-foreground sm:inline-block">
              v{CORE_PACKAGE_VERSION}
            </span>
          </Link>

          <nav className="ml-8 hidden items-center gap-5 text-sm xl:flex">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                transitionTypes={["nav-forward"]}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/docs/installation"
              transitionTypes={["nav-forward"]}
              aria-label="Installation"
              onClick={closeMobileNav}
              className={
                buttonVariants({ variant: "ghost", size: "sm" }) +
                " hidden sm:inline-flex xl:hidden"
              }
            >
              <PackageIcon className="size-4" />
            </Link>

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

              <Link
                href="/docs/installation"
                transitionTypes={["nav-forward"]}
                aria-label="Installation"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <PackageIcon className="size-4" />
              </Link>
            </div>

            <div className="relative xl:hidden">
              {mobileNavOpen ? (
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  className="fixed inset-0 top-14 z-40 bg-background/40 backdrop-blur-[2px]"
                  onClick={closeMobileNav}
                />
              ) : null}

              <button
                ref={mobileNavButtonRef}
                type="button"
                aria-label={
                  mobileNavOpen
                    ? "Close navigation menu"
                    : "Open navigation menu"
                }
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
                  "mobile-nav__panel absolute top-[calc(100%+0.5rem)] right-0 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-2 shadow-lg backdrop-blur " +
                  (mobileNavOpen
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none -translate-y-2 scale-[0.98] opacity-0")
                }
              >
                <nav className="flex flex-col gap-1">
                  {primaryNav.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      transitionTypes={["nav-forward"]}
                      onClick={closeMobileNav}
                      className="rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      {item.label}
                    </Link>
                  ))}

                  <Link
                    href="/docs/installation"
                    transitionTypes={["nav-forward"]}
                    onClick={closeMobileNav}
                    className="rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    Installation
                  </Link>
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
