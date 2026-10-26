"use client";

import { Fragment } from "react";

import { cn } from "@/infrastructure/ui";

import { type Command, readsLine, toolsLine } from "./registry";

/**
 * The list under the prompt while it starts with `/`. Focus stays in the
 * textarea: the prompt bar feeds key presses through `paletteKey` and points
 * `aria-activedescendant` at `commandOptionId(active.name)`.
 */

export type PaletteAction =
  { kind: "move"; index: number } | "pick" | "unknown" | "close" | null;

/** Enter with nothing matching is "unknown": the bar says so and keeps the text. */
export const paletteKey = (key: string, active: number, count: number): PaletteAction => {
  if (key === "Escape") return "close";
  if (key === "Enter") return count === 0 ? "unknown" : "pick";
  if (count === 0) return null;
  if (key === "ArrowDown") return { kind: "move", index: (active + 1) % count };
  if (key === "ArrowUp") return { kind: "move", index: (active + count - 1) % count };
  return null;
};

export const commandOptionId = (name: string): string => `command-option-${name}`;

/** What the palette says after Enter on a `/word` that names no command. */
export const unknownCommandHint = (draft: string): string =>
  `No command ${draft.trim()}. Type / to see commands.`;

/** One option: its name and what it does, then what it reads and may call. */
const CommandOption = ({
  command,
  active,
  onPick,
}: Readonly<{
  command: Command;
  active: boolean;
  onPick: (command: Command) => void;
}>) => (
  <li>
    <button
      type="button"
      role="option"
      id={commandOptionId(command.name)}
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(command)}
      className={cn(
        "hover:bg-muted block w-full rounded-lg px-2 py-2 text-left transition-colors",
        active && "bg-muted",
      )}
    >
      <span className="block text-sm font-medium">/{command.name}</span>
      <span className="text-muted-foreground block text-xs leading-snug">
        {command.description}
      </span>
      <span className="text-muted-foreground block text-xs leading-snug">
        {readsLine(command.reads)}
      </span>
      {command.tools ? (
        <span className="text-muted-foreground block font-mono text-[11px] leading-snug">
          {toolsLine(command.tools)}
        </span>
      ) : null}
    </button>
  </li>
);

/**
 * Built-ins first, then a "Skills" heading over the skills. `activeIndex`
 * counts over the flat list, so keys move through both groups.
 */
export const CommandPalette = ({
  commands,
  activeIndex,
  onPick,
  notice,
}: Readonly<{
  commands: readonly Command[];
  activeIndex: number;
  onPick: (command: Command) => void;
  /** Replaces the empty-list line, e.g. after Enter on an unknown command. */
  notice?: string;
}>) => {
  const firstSkill = commands.findIndex((command) => command.kind === "skill");
  return (
    <div className="border-border bg-background absolute bottom-full left-0 z-20 mb-2 w-80 max-w-full overflow-hidden rounded-lg border shadow-md">
      <div className="border-border border-b px-3 py-2">
        <p className="text-eyebrow">Commands</p>
      </div>
      {commands.length === 0 ? (
        <p role="status" className="text-muted-foreground px-3 py-2 text-xs">
          {notice ?? "No command with that name."}
        </p>
      ) : (
        <ul role="listbox" aria-label="Commands" className="p-1.5">
          {commands.map((command, index) => (
            <Fragment key={command.name}>
              {index === firstSkill ? (
                <li role="presentation" className="text-eyebrow px-2 pt-2 pb-1">
                  Skills
                </li>
              ) : null}
              <CommandOption
                command={command}
                active={index === activeIndex}
                onPick={onPick}
              />
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
};
