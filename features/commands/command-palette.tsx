"use client";

import { Fragment, useEffect } from "react";

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

export const commandDetailId = (name: string): string => `command-detail-${name}`;

/**
 * What a command reads and may call (#455). What a command reads is the
 * privacy point of the list, so it is on screen before anyone picks:
 *
 * - Below `sm` every row shows its detail under it, since a tap picks at once
 *   and a phone has no hover to move the highlight.
 * - From `sm` up the highlighted command's detail sits beside the list, and
 *   pointing at a row highlights it, as in the `@` menu.
 *
 * Assistive technology gets one description, the highlighted option's: its
 * detail under the row carries the id its `aria-describedby` names and stays
 * in the accessibility tree from `sm` up (`sr-only`, not `hidden`). The other
 * rows' details are visual copies passed `hidden`; the side pane is hidden
 * as a whole.
 */
const CommandDetail = ({
  command,
  id,
  hidden,
  className,
}: Readonly<{ command: Command; id?: string; hidden: boolean; className: string }>) => (
  <div
    id={id}
    aria-hidden={hidden ? true : undefined}
    className={cn("text-muted-foreground text-xs leading-snug", className)}
  >
    <p>{readsLine(command.reads)}</p>
    {command.tools ? <p className="mt-1">{toolsLine(command.tools)}</p> : null}
  </div>
);

/**
 * One option on one line: its name and what it does, with its detail under it.
 * Exported for its test, which calls it to reach the button's handlers.
 */
export const CommandOption = ({
  command,
  active,
  onPick,
  onHover,
}: Readonly<{
  command: Command;
  active: boolean;
  onPick: (command: Command) => void;
  onHover: () => void;
}>) => (
  <li>
    <button
      type="button"
      role="option"
      id={commandOptionId(command.name)}
      aria-selected={active}
      aria-describedby={active ? commandDetailId(command.name) : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onPointerEnter={onHover}
      onClick={() => onPick(command)}
      className={cn(
        "hover:bg-muted flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        active && "bg-muted",
      )}
    >
      <span className="shrink-0 text-sm font-medium">/{command.name}</span>
      <span
        title={command.description}
        className="text-muted-foreground min-w-0 truncate text-xs"
      >
        {command.description}
      </span>
    </button>
    {active ? (
      <CommandDetail
        command={command}
        id={commandDetailId(command.name)}
        hidden={false}
        className="px-2 pt-1 pb-2 sm:sr-only"
      />
    ) : (
      <CommandDetail command={command} hidden className="px-2 pt-1 pb-2 sm:hidden" />
    )}
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
  onHover,
  notice,
}: Readonly<{
  commands: readonly Command[];
  activeIndex: number;
  onPick: (command: Command) => void;
  /** Pointing at a row highlights it, so its detail shows beside the list. */
  onHover: (index: number) => void;
  /** Replaces the empty-list line, e.g. after Enter on an unknown command. */
  notice?: string;
}>) => {
  const firstSkill = commands.findIndex((command) => command.kind === "skill");
  const active = commands[activeIndex];
  const activeName = active?.name;
  // Arrow keys move the highlight; keep its row, with the detail under it on
  // a phone, in view inside the scrolling list.
  useEffect(() => {
    if (!activeName) return;
    document
      .getElementById(commandOptionId(activeName))
      ?.closest("li")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeName]);
  return (
    <div className="border-border bg-background absolute bottom-full left-0 z-20 mb-2 flex max-h-[min(28rem,60vh)] w-80 max-w-full flex-col overflow-hidden rounded-lg border shadow-md sm:w-[34rem]">
      <div className="border-border shrink-0 border-b px-3 py-2">
        <p className="text-eyebrow">Commands</p>
      </div>
      {commands.length === 0 || active === undefined ? (
        <p role="status" className="text-muted-foreground px-3 py-2 text-xs">
          {notice ?? "No command with that name."}
        </p>
      ) : (
        <div className="flex min-h-0">
          <ul
            role="listbox"
            aria-label="Commands"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
          >
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
                  onHover={() => onHover(index)}
                />
              </Fragment>
            ))}
          </ul>
          <aside
            aria-hidden="true"
            className="border-border hidden w-52 shrink-0 overflow-y-auto border-l p-3 sm:block"
          >
            <p className="text-sm font-medium">/{active.name}</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
              {active.description}
            </p>
            {/* The aside is aria-hidden already, so its copy needs no mark of its own. */}
            <CommandDetail command={active} hidden={false} className="mt-2" />
          </aside>
        </div>
      )}
    </div>
  );
};
