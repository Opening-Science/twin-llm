"use client";

import { isoLocalDate } from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import { resolveSyncDateWindow } from "./sync-window";

export type DateRangeValue = Readonly<{
  startDate: string;
  endDate: string;
}>;

const PRESETS = [
  { id: "7", label: "7 days", days: 7 },
  { id: "14", label: "14 days", days: 14 },
  { id: "30", label: "30 days", days: 30 },
] as const;

const rangeForDays = (days: number): DateRangeValue => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return {
    startDate: isoLocalDate(start),
    endDate: isoLocalDate(end),
  };
};

export const defaultDateRange = (): DateRangeValue => rangeForDays(14);

type DateRangeBarProps = {
  readonly value: DateRangeValue;
  readonly onChange: (next: DateRangeValue) => void;
  readonly onApplySync: () => void;
  readonly syncing: boolean;
  readonly canSync: boolean;
};

export const DateRangeBar = ({
  value,
  onChange,
  onApplySync,
  syncing,
  canSync,
}: DateRangeBarProps) => {
  const activePreset = PRESETS.find((p) => {
    const r = rangeForDays(p.days);
    return r.startDate === value.startDate && r.endDate === value.endDate;
  });

  return (
    <div className="surface mt-6 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div>
        <p className="text-eyebrow">Timeline</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Filter the dashboard and re-sync this window (max 90 days).
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <SegmentedControl
          label="Preset ranges"
          size="sm"
          options={PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          value={activePreset?.id ?? null}
          onChange={(id) => {
            const preset = PRESETS.find((p) => p.id === id);
            if (preset) onChange(rangeForDays(preset.days));
          }}
        />
        <label className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
          From
          <input
            type="date"
            max={value.endDate}
            value={value.startDate}
            onChange={(e) =>
              onChange(
                resolveSyncDateWindow({
                  startDate: e.target.value || value.startDate,
                  endDate: value.endDate,
                }),
              )
            }
            className="border-input bg-background text-foreground rounded-md border px-2 py-1 font-mono text-xs"
          />
        </label>
        <label className="text-muted-foreground flex flex-col gap-0.5 text-[11px]">
          To
          <input
            type="date"
            min={value.startDate}
            max={isoLocalDate()}
            value={value.endDate}
            onChange={(e) =>
              onChange(
                resolveSyncDateWindow({
                  startDate: value.startDate,
                  endDate: e.target.value || value.endDate,
                }),
              )
            }
            className="border-input bg-background text-foreground rounded-md border px-2 py-1 font-mono text-xs"
          />
        </label>
        <Button size="sm" disabled={!canSync || syncing} onClick={onApplySync}>
          {syncing ? "Syncing…" : "Sync window"}
        </Button>
      </div>
    </div>
  );
};
