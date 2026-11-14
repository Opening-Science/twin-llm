"use client";

import { cn } from "@/infrastructure/ui";

import { type SourceOption, sourceOptionId } from "./prompt-menus";

/**
 * The `@` sources list under the prompt box. Focus stays in the box: the bar
 * feeds keys through `sourceKey` and points `aria-activedescendant` at the
 * active option. A mention is plain text; it changes no permission.
 */
export const SourcesMenu = ({
  options,
  activeIndex,
  onPick,
  onHover,
}: Readonly<{
  options: readonly SourceOption[];
  activeIndex: number;
  onPick: (option: SourceOption) => void;
  onHover: (index: number) => void;
}>) => (
  <div className="border-border bg-background absolute bottom-full left-0 z-20 mb-2 w-72 max-w-full overflow-hidden rounded-lg border shadow-md">
    <div className="border-border border-b px-3 py-2">
      <p className="text-eyebrow">Sources</p>
      <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
        A mention is a word in your question; it switches nothing on.
      </p>
    </div>
    {options.length === 0 ? (
      <p role="status" className="text-muted-foreground px-3 py-2 text-xs">
        No source with that name.
      </p>
    ) : (
      <ul role="listbox" aria-label="Sources" className="max-h-64 overflow-y-auto p-1.5">
        {options.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              id={sourceOptionId(option.id)}
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onPointerEnter={() => onHover(index)}
              onClick={() => onPick(option)}
              className={cn(
                "hover:bg-muted flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                index === activeIndex && "bg-muted",
                option.kind === "import" && "text-muted-foreground",
              )}
            >
              {option.kind === "import"
                ? option.name
                : `@${option.name.replace(/\s+/g, "")}`}
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);
