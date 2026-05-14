"use client"

import * as React from "react"
import { MoonIcon, MoonStarsIcon, SunIcon } from "@phosphor-icons/react"
import { useTheme } from "next-themes"

import { THEMES } from "@/components/theme-provider"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const THEME_LABELS: Record<(typeof THEMES)[number], string> = {
  light: "Light",
  dark: "Dark",
  dim: "Dim",
}

const THEME_ICONS = {
  light: SunIcon,
  dark: MoonStarsIcon,
  dim: MoonIcon,
} satisfies Record<(typeof THEMES)[number], React.ComponentType<{ className?: string }>>

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  const activeTheme = mounted && theme && theme in THEME_LABELS ? (theme as (typeof THEMES)[number]) : "light"
  const ActiveThemeIcon = THEME_ICONS[activeTheme]
  const activeThemeIndex = THEMES.indexOf(activeTheme)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 border border-border bg-background/80 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground backdrop-blur sm:flex lg:hidden">
        <ActiveThemeIcon className="size-3.5 text-foreground" />
        <span>{THEME_LABELS[activeTheme]}</span>
      </div>

      <div
        aria-label="Theme switcher"
        className="relative grid grid-cols-3 items-center rounded-none border border-border bg-background/80 p-1 backdrop-blur"
        role="group"
        title="Theme preference is saved on this device"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-none bg-foreground shadow-sm transition-transform duration-300 ease-out"
          style={{ transform: `translateX(calc(${activeThemeIndex} * 100%))` }}
        />

        {THEMES.map((themeOption) => {
          const isActive = mounted && theme === themeOption
          const ThemeIcon = THEME_ICONS[themeOption]

          return (
            <button
              key={themeOption}
              type="button"
              aria-label={`Switch to ${THEME_LABELS[themeOption]} theme`}
              aria-pressed={isActive}
              onClick={() => setTheme(themeOption)}
              className={cn(
                buttonVariants({ variant: "ghost", size: "xs" }),
                "relative z-10 min-w-0 gap-1.5 border-transparent bg-transparent px-2 text-[10px] transition-colors duration-300 ease-out hover:bg-transparent sm:min-w-16",
                isActive
                  ? "text-background hover:bg-transparent hover:text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ThemeIcon className="size-3.5" />
              <span className="hidden sm:inline">{THEME_LABELS[themeOption]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}