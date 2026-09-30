import type { ReactNode } from "react";
import { FileIcon, FolderOpenIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

/**
 * File-tree container for showing a project layout. Nest {@link Folder} and
 * {@link File} inside it.
 *
 * @example
 * <Files>
 *   <Folder name="src">
 *     <File name="app.ts" />
 *   </Folder>
 *   <File name="package.json" />
 * </Files>
 */
export function Files({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-files
      className={cn("not-prose my-6 rounded-xl border bg-card p-3 font-mono text-[13px] leading-6", className)}
    >
      <ul className="space-y-0.5">
        {children}
      </ul>
    </div>
  );
}

/** Props accepted by {@link Folder}. */
export interface FolderProps {
  name: string;
  /** Start expanded. Defaults to `true`, since trees in docs are usually shown open. */
  defaultOpen?: boolean;
  /** Optional muted note rendered after the name, e.g. `"generated"`. */
  note?: ReactNode;
  children?: ReactNode;
}

/**
 * A directory in a {@link Files} tree. Uses a native `<details>` so it is
 * collapsible without client JavaScript.
 */
export function Folder({ name, defaultOpen = true, note, children }: FolderProps) {
  return (
    <li>
      <details open={defaultOpen} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1.5 hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
          <FolderOpenIcon aria-hidden className="size-4 shrink-0 text-amber-600 dark:text-amber-400" weight="duotone" />
          <span className="text-foreground">{name}</span>
          {note ? <span className="text-muted-foreground">{note}</span> : null}
        </summary>
        <ul className="ms-3.5 space-y-0.5 border-s ps-2">
          {children}
        </ul>
      </details>
    </li>
  );
}

/** Props accepted by {@link File}. */
export interface FileProps {
  name: string;
  /** Optional muted note rendered after the name, e.g. `"your routes"`. */
  note?: ReactNode;
}

/** A file leaf in a {@link Files} tree. */
export function File({ name, note }: FileProps) {
  return (
    <li className="flex items-center gap-2 px-1.5">
      <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
      <span className="text-foreground">{name}</span>
      {note ? <span className="text-muted-foreground">{note}</span> : null}
    </li>
  );
}
