'use client'

import * as React from 'react'
import { addTransitionType, startTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { Button } from './ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command'
import type { DocsSearchSection } from '@/lib/docs-search'

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName

  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable
  )
}

function scoreDocsItem(value: string, search: string) {
  const haystack = value.toLowerCase()
  const needle = search.toLowerCase().trim()

  if (!needle) {
    return 1
  }

  if (haystack.includes(needle)) {
    // Boost matches that hit the title (first segment of value) so e.g.
    // searching "redis" surfaces the "Redis rate-limit store" page first.
    return haystack.startsWith(needle) ? 1 : 0.75
  }

  const tokens = needle.split(/\s+/).filter(Boolean)

  if (tokens.length > 1 && tokens.every((token) => haystack.includes(token))) {
    return 0.5
  }

  return 0
}

export function DocsSearch({ sections }: { sections: DocsSearchSection[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const handleKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') {
      return
    }

    if (isTypingTarget(event.target)) {
      return
    }

    event.preventDefault()
    setOpen((currentOpen) => !currentOpen)
  })

  React.useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  function handleSelect(href: string) {
    setOpen(false)
    startTransition(() => {
      addTransitionType('nav-forward')
      router.push(href)
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 w-full justify-between rounded-xl border-border bg-background/80 px-4 text-[11px] tracking-[0.22em] text-muted-foreground hover:bg-muted/60 sm:text-xs"
        onClick={() => setOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <MagnifyingGlassIcon className="size-4" />
          <span className="truncate">Search documentation</span>
        </span>
        <span className="hidden items-center gap-1 text-[10px] text-muted-foreground/90 sm:inline-flex">
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono tracking-normal text-foreground/80 uppercase">
            Cmd
          </span>
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono tracking-normal text-foreground/80 uppercase">
            K
          </span>
        </span>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search docs"
        description="Jump between documentation pages."
        className="max-w-2xl rounded-2xl border border-border bg-background/95 p-0 shadow-2xl"
      >
        <Command filter={scoreDocsItem}>
          <CommandInput placeholder="Search docs, topics, and routes..." />
          <CommandList className="max-h-104">
            <CommandEmpty>
              No documentation page matched your search.
            </CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.heading} heading={section.heading}>
                {section.items.map((item) => {
                  const active = pathname === item.href

                  return (
                    <CommandItem
                      key={item.href}
                      value={`${item.title} ${item.keywords}`}
                      onSelect={() => handleSelect(item.href)}
                      className="gap-3 rounded-xl px-4 py-3 data-selected:bg-muted/80"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground">
                          {item.title}
                        </div>
                        <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {item.description}
                        </div>
                      </div>
                      <CommandShortcut>
                        {active ? 'Current' : 'Open'}
                      </CommandShortcut>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
