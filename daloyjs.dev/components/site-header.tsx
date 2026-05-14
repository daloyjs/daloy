import Link from "next/link";
import { GithubLogoIcon, PackageIcon } from "@phosphor-icons/react/ssr";
import { buttonVariants } from "./ui/button";
import { ThemeSwitcher } from "./theme-switcher";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            dj
          </span>
          <span>DaloyJS</span>
          <span className="hidden sm:inline-block text-xs font-mono text-muted-foreground ml-1">v0.1</span>
        </Link>

        <nav className="ml-8 hidden md:flex items-center gap-5 text-sm">
          <Link href="/docs" className="text-muted-foreground hover:text-foreground transition-colors">
            Docs
          </Link>
          <Link href="/docs/getting-started" className="text-muted-foreground hover:text-foreground transition-colors">
            Getting started
          </Link>
          <Link href="/docs/tutorials/bookstore" className="text-muted-foreground hover:text-foreground transition-colors">
            Tutorials
          </Link>
          <Link href="/docs/api-reference" className="text-muted-foreground hover:text-foreground transition-colors">
            API
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitcher />
          <a
            href="https://github.com/daloyjs/daloy"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <GithubLogoIcon className="size-4" />
          </a>
          <Link href="/docs/installation" aria-label="Installation" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <PackageIcon className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
