"use client";

import Link from "next/link";
import { useId } from "react";

import { AUTO_MODEL_ID, type CatalogModel } from "@/infrastructure/model-catalog";
import { friendlyModelName } from "@/infrastructure/model-names";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";
import { cn } from "@/infrastructure/ui";

import {
  boxChecked,
  boxDisabled,
  type ChatMode,
  MODE_COPY,
  type ModeContext,
  modeSummary,
  type ModeState,
  offeredModes,
  pickerFooter,
  type PickerList,
  plainModelRows,
  rowRunsHere,
  setMode,
  specialistRows,
  toggleRow,
} from "./chat-modes";

/**
 * The mode and models picker (SPEC 7.4): opens upward from the mode pill.
 * A segmented "Mode" control, the mode's line, then for Manual and Compare
 * two checkbox groups. A box whose change would break the rule is disabled
 * and says why; in incognito, rows not on this machine stay listed, greyed.
 */

export const AGENTS_HREF = "/customize/agents";

const PILL =
  "border-input hover:bg-muted text-foreground inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** The small line under a row's name. */
export const rowSubline = (row: CatalogModel): string => {
  if (row.id === AUTO_MODEL_ID) return "Picks an agent for each question.";
  if (row.agent !== undefined) return `on ${row.agent.baseModelName}`;
  return friendlyModelName(row.id) === null ? row.provider : row.id;
};

const RowBox = ({
  row,
  list,
  state,
  context,
  prompt,
  onChange,
}: Readonly<{
  row: CatalogModel;
  list: PickerList;
  state: ModeState;
  context: ModeContext;
  prompt: string;
  onChange: (state: ModeState) => void;
}>) => {
  const reasonId = useId();
  const reason = boxDisabled(state, list, row.id, context, prompt);
  const local = rowRunsHere(row.id, context);
  return (
    <li>
      <label
        className={cn(
          "hover:bg-muted flex items-start gap-2 rounded-md px-2 py-1.5 text-sm",
          reason !== null && "cursor-not-allowed",
          !local && "text-muted-foreground",
        )}
      >
        <input
          type="checkbox"
          className="accent-foreground mt-0.5"
          checked={boxChecked(state, list, row.id, context, prompt)}
          disabled={reason !== null}
          aria-describedby={reason === null ? undefined : reasonId}
          onChange={() => onChange(toggleRow(state, list, row.id, context, prompt))}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{row.name}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {rowSubline(row)}
          </span>
          {reason === null ? null : (
            <span id={reasonId} className="text-muted-foreground block text-xs">
              {reason}
            </span>
          )}
        </span>
      </label>
    </li>
  );
};

const RowGroup = ({
  legend,
  rows,
  list,
  ...rest
}: Readonly<{
  legend: string;
  rows: readonly CatalogModel[];
  list: PickerList;
  state: ModeState;
  context: ModeContext;
  prompt: string;
  onChange: (state: ModeState) => void;
}>) =>
  rows.length === 0 ? null : (
    <fieldset className="min-w-0">
      <legend className="text-eyebrow px-2 pb-1">{legend}</legend>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <RowBox key={row.id} row={row} list={list} {...rest} />
        ))}
      </ul>
    </fieldset>
  );

export const ModePicker = ({
  state,
  context,
  prompt,
  onChange,
  disabled = false,
}: Readonly<{
  state: ModeState;
  context: ModeContext;
  prompt: string;
  onChange: (state: ModeState) => void;
  disabled?: boolean;
}>) => {
  const summary = modeSummary(state, context, prompt);
  const modes = offeredModes(context);
  const shared = { state, context, prompt, onChange };
  return (
    <Popover>
      <PopoverTrigger
        className={PILL}
        disabled={disabled}
        aria-label={`Mode and models: ${summary}`}
      >
        {summary}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
      >
        <SegmentedControl<ChatMode>
          label="Mode"
          size="sm"
          options={modes.map((mode) => ({ value: mode, label: MODE_COPY[mode].label }))}
          value={state.mode}
          onChange={(mode) => onChange(setMode(state, mode))}
        />
        <p className="text-muted-foreground text-xs leading-snug">
          {MODE_COPY[state.mode].line}
        </p>
        {state.mode === "auto" ? (
          <Link href={AGENTS_HREF} className="text-xs underline underline-offset-2">
            The specialists Auto picks from
          </Link>
        ) : (
          <div className="flex max-h-[18rem] flex-col gap-3 overflow-y-auto overscroll-contain">
            <RowGroup
              legend="Specialists"
              rows={specialistRows(context.catalog)}
              list={state.mode === "manual" ? "specialists" : "compare"}
              {...shared}
            />
            <RowGroup
              legend="Models"
              rows={plainModelRows(context.catalog)}
              list={state.mode === "manual" ? "models" : "compare"}
              {...shared}
            />
          </div>
        )}
        <p className="border-border text-muted-foreground border-t pt-2 text-xs">
          {pickerFooter(state, context, prompt)}
        </p>
      </PopoverContent>
    </Popover>
  );
};
