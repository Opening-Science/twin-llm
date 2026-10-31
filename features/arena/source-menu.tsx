"use client";

import { cn } from "@/infrastructure/ui";

import type { PromptSource } from "./prompt-sources";

/**
 * The list over the prompt while an `@` word is typed or the sources button
 * is pressed (#366). Focus stays in the text box, which points
 * `aria-activedescendant` at `sourceOptionId(key)`; the bar feeds it the
 * arrow keys. "Import a file" is a row like the others and opens the import
 * page.
 */

export const sourceOptionId = (key: string): string => `source-option-${key}`;

export const SourceMenu = ({
  sources,
  activeIndex,
  onPick,
  onHover,
}: Readonly<{
  sources: readonly PromptSource[];
  activeIndex: number;
  onPick: (source: PromptSource) => void;
  onHover: (index: number) => void;
}>) => (
  <div className="border-border bg-popover absolute bottom-full left-0 z-20 mb-2 w-80 max-w-full overflow-hidden rounded-lg border shadow-md">
    <div className="border-border border-b px-3 py-2">
      <p className="text-eyebrow">Sources</p>
    </div>
    {sources.length === 0 ? (
      <p role="status" className="text-muted-foreground px-3 py-2 text-xs">
        No source by that name here.
      </p>
    ) : (
      <ul role="listbox" aria-label="Sources" className="p-1.5">
        {sources.map((source, index) => (
          <li key={source.key}>
            <button
              type="button"
              role="option"
              id={sourceOptionId(source.key)}
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => onHover(index)}
              onClick={() => onPick(source)}
              className={cn(
                "hover:bg-muted block w-full rounded-lg px-2 py-2 text-left transition-colors",
                index === activeIndex && "bg-muted",
              )}
            >
              <span className="block text-sm font-medium">
                {source.href === undefined ? `@${source.name}` : source.name}
              </span>
              <span className="text-muted-foreground block text-xs leading-snug">
                {source.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
    <p className="text-muted-foreground border-border border-t px-3 py-2 text-[11px] leading-snug">
      A mention is part of your question. It does not change which data the answer may
      read.
    </p>
  </div>
);
