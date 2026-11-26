import { Check, Info, Plus } from "lucide-react";

import { cn } from "@/infrastructure/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";

import { YOUR_DAY_COPY } from "../../../twin-page-copy";
import { type YourDayChartId } from "../your-day-charts";
import { type PickerEntry } from "../your-day-picker-catalog";

const COPY = YOUR_DAY_COPY.chartPicker;
const card =
  "border-input bg-card relative flex h-full w-full items-start justify-between gap-2 rounded-xl border p-3 text-start";
const indicator = "grid size-5 shrink-0 place-items-center rounded border";

export function PickerCard({
  entry,
  dialogId,
  dialog,
  checked,
  atLimit,
  onToggle,
}: Readonly<{
  entry: PickerEntry;
  dialogId: string;
  dialog: HTMLDialogElement | null;
  checked: boolean;
  atLimit: boolean;
  onToggle: (id: YourDayChartId) => void;
}>) {
  const { id, chartId, label, provider, description, unit, unavailableReason } = entry;
  const nameId = `${dialogId}-${id}-label`;
  const detailsId = `${dialogId}-${id}-details`;
  const details = (
    <span className="max-h-full min-w-0 overflow-hidden wrap-break-word">
      <span id={nameId} className="line-clamp-2 text-sm font-semibold">
        {label}
      </span>
      <span id={detailsId} className="mt-1 block text-xs">
        {unit && (
          <span className="text-muted-foreground block">
            {COPY.unit} {unit}
          </span>
        )}
        <span className="text-muted-foreground block">
          {COPY.provider} {provider}
        </span>
        <span className="mt-1 line-clamp-2 leading-snug">{description}</span>
      </span>
    </span>
  );

  if (chartId === null || (!checked && atLimit)) {
    const reason = chartId === null ? (unavailableReason ?? COPY.noSeries) : COPY.full;
    return (
      <li className={`${card} text-muted-foreground`}>
        <div
          role="group"
          aria-disabled="true"
          aria-labelledby={nameId}
          aria-describedby={detailsId}
          className="max-h-full min-w-0 overflow-hidden"
        >
          {details}
        </div>
        <Popover>
          <PopoverTrigger
            aria-label={COPY.whyUnavailable(label)}
            className={`${indicator} focus-visible:outline-ring border-input text-foreground hover:bg-muted size-7 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2`}
          >
            <Info aria-hidden="true" className="size-3.5" />
          </PopoverTrigger>
          {dialog && (
            <PopoverContent
              container={dialog}
              align="end"
              collisionPadding={12}
              aria-label={COPY.availability(label)}
              className="max-w-[calc(100vw-2.5rem)] p-3 text-xs shadow-lg"
            >
              {reason}
            </PopoverContent>
          )}
        </Popover>
      </li>
    );
  }

  return (
    <li>
      <label
        className={`${card} hover:bg-muted has-checked:border-foreground has-checked:inset-ring-foreground focus-within:outline-ring cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 has-checked:inset-ring-1`}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-labelledby={nameId}
          aria-describedby={detailsId}
          onChange={() => onToggle(chartId)}
          className="sr-only"
        />
        {details}
        <span
          aria-hidden="true"
          className={cn(
            indicator,
            checked
              ? "border-foreground bg-foreground text-background"
              : "border-input text-foreground",
          )}
        >
          {checked ? <Check className="size-3" /> : <Plus className="size-3" />}
        </span>
      </label>
    </li>
  );
}
