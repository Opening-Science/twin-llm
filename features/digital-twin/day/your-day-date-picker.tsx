"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { DayPicker } from "react-day-picker";

import { addDays } from "@/features/wearables/local-clock";
import { formatDate, formatWeekday, isoLocalDate } from "@/infrastructure/format-measure";
import { cn } from "@/infrastructure/ui";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";
import { useReducedMotion } from "@/infrastructure/ui-kit/use-reduced-motion";

import { YOUR_DAY_COPY } from "../twin-page-copy";

const COPY = YOUR_DAY_COPY.picker;
const localDate = (day: string) => new Date(`${day}T12:00:00`);
const subscribe = () => () => undefined;
const serverToday = () => null;
const ARROW_CLASS = "grid size-8 shrink-0 place-items-center rounded-md hover:bg-muted";
const MONTH_ARROW_CLASS = `${ARROW_CLASS} bg-muted hover:bg-accent/70`;

function Arrow({
  direction,
  label,
  onClick,
  disabled = false,
}: Readonly<{
  direction: -1 | 1;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={ARROW_CLASS}
      disabled={disabled}
      onClick={onClick}
    >
      <ChevronIcon className={cn("size-4", direction === -1 && "rotate-180")} />
    </button>
  );
}

export function YourDayDatePicker({
  selected,
  onSelect,
}: Readonly<{ selected: string; onSelect: (date: string) => void }>) {
  const reducedMotion = useReducedMotion();
  const today = useSyncExternalStore(subscribe, isoLocalDate, serverToday);
  const [isOpen, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      trigger.current?.focus();
      setOpen(false);
    };
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", dismissOnEscape);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("keydown", dismissOnEscape);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [isOpen]);

  const close = () => {
    trigger.current?.focus();
    setOpen(false);
  };
  const select = (day: string) => {
    onSelect(day);
    close();
  };
  const step = (days: number) => {
    onSelect(addDays(selected, days));
    setOpen(false);
  };

  return (
    <div
      ref={picker}
      role="group"
      aria-label={COPY.group}
      className="dark text-foreground relative z-20 w-60 min-w-0"
    >
      <div className="border-input bg-card flex items-center rounded-[10px] border p-0.5">
        <Arrow direction={-1} label={COPY.previousDay} onClick={() => step(-1)} />
        <button
          ref={trigger}
          type="button"
          className="hover:bg-muted min-h-8 min-w-0 flex-1 truncate rounded-md px-1 text-xs font-medium"
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
          aria-haspopup="dialog"
          aria-live="polite"
          onClick={() => setOpen(!isOpen)}
        >
          <span className="sr-only">{COPY.current}</span>
          {formatDate(selected, "weekday")}
        </button>
        <Arrow direction={1} label={COPY.nextDay} onClick={() => step(1)} />
      </div>
      {isOpen ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={COPY.dialog}
          className="border-border bg-popover text-popover-foreground absolute top-full left-0 mt-2 w-[min(100cqw,19rem)] rounded-xl border p-3 shadow-xl @lg/replay:right-0 @lg/replay:left-auto"
        >
          <DayPicker
            mode="single"
            required
            autoFocus
            animate={!reducedMotion}
            weekStartsOn={1}
            fixedWeeks
            showOutsideDays
            navLayout="after"
            defaultMonth={localDate(selected)}
            selected={localDate(selected)}
            today={today ? localDate(today) : undefined}
            onSelect={(day) => select(isoLocalDate(day))}
            formatters={{ formatWeekdayName: formatWeekday }}
            components={{
              Chevron: ({ orientation }) => (
                <ChevronIcon
                  className={cn("size-4", orientation === "left" && "rotate-180")}
                />
              ),
            }}
            classNames={{
              root: "rdp-root",
              months: "w-full",
              month: "w-full",
              month_caption:
                "mb-1.5 flex h-8 items-center pr-[4.75rem] text-sm font-semibold",
              nav: "absolute top-0 right-0 flex gap-1",
              button_previous: MONTH_ARROW_CLASS,
              button_next: MONTH_ARROW_CLASS,
              month_grid: "w-full table-fixed border-collapse text-center",
              weekday: "text-muted-foreground py-1 text-xs font-normal",
              weeks: "[&>tr:last-child>td]:pb-0",
              day: "group px-0.5 pb-1 last:pr-0 first:pl-0",
              day_button: cn(
                "hover:bg-muted min-h-8 w-full rounded-md border border-transparent text-xs",
                "group-data-outside:text-muted-foreground",
                "group-[[data-today]:not([data-selected])]:border-input",
                "group-data-selected:bg-foreground group-data-selected:text-background",
                "group-data-selected:font-semibold group-data-selected:hover:bg-foreground/90",
              ),
            }}
          />
          <div className="border-border mt-2 flex items-center justify-between gap-2 border-t pt-2">
            <div>
              <p className="text-muted-foreground text-xs">{COPY.selected}</p>
              <p className="mt-0.5 text-xs font-medium">{formatDate(selected)}</p>
            </div>
            <button
              type="button"
              onClick={() => select(isoLocalDate())}
              className="border-input hover:bg-muted min-h-8 rounded-md border px-3 text-xs font-medium"
            >
              {COPY.today}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
