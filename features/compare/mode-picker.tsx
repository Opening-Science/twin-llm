"use client";

import Link from "next/link";
import { useId, useState } from "react";

import type { CatalogModel } from "@/infrastructure/model-catalog";
import { Button } from "@/infrastructure/ui-kit/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";
import { cn } from "@/infrastructure/ui";

import {
  autoModelName,
  boxChecked,
  boxDisabled,
  canAddSpecialist,
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
  rowSubline,
  setMode,
  setSpecialistModel,
  specialistModel,
  specialistModelChoices,
  specialistOf,
  specialistPicks,
  specialistRows,
  specialistTools,
  toggleRow,
} from "./chat-modes";

/**
 * The mode and models picker (SPEC 7.4): opens upward from the mode pill.
 * A segmented "Mode" control, the mode's line, then for Basic one radio
 * group of models, for Specialists the ones answering with their models and
 * an add button, and for Compare two checkbox groups. A box whose change
 * would break the rule is disabled and says why; in incognito, rows not on
 * this machine stay listed, greyed.
 */

export const AGENTS_HREF = "/customize/agents";

const PILL =
  "border-input hover:bg-muted text-foreground inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

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
          type={list === "basic" ? "radio" : "checkbox"}
          name={list === "basic" ? "basic-model" : undefined}
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

type PanelProps = Readonly<{
  state: ModeState;
  context: ModeContext;
  prompt: string;
  onChange: (state: ModeState) => void;
}>;

/**
 * One specialist answering: its box, its name, the model it runs on as a
 * choice (its own by default, any plain model the catalog offers), and its
 * tools.
 */
const AnsweringRow = ({
  pick,
  row,
  state,
  context,
  prompt,
  onChange,
}: PanelProps & Readonly<{ pick: string; row: CatalogModel }>) => {
  const reasonId = useId();
  const reason = boxDisabled(state, "specialists", row.id, context, prompt);
  const tools = specialistTools(row);
  return (
    <li className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
      <input
        type="checkbox"
        className="accent-foreground mt-0.5"
        aria-label={row.name}
        checked
        disabled={reason !== null}
        aria-describedby={reason === null ? undefined : reasonId}
        onChange={() =>
          onChange(toggleRow(state, "specialists", row.id, context, prompt))
        }
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.name}</span>
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          on
          <select
            aria-label={`Model for ${row.name}`}
            value={specialistModel(pick, context) ?? ""}
            onChange={(event) =>
              onChange(
                setSpecialistModel(state, context, prompt, pick, event.target.value),
              )
            }
            className="border-input bg-background text-foreground max-w-[11rem] truncate rounded-md border px-1 py-0.5 text-xs"
          >
            {specialistModelChoices(pick, context).map((choice) => (
              <option key={choice.id} value={choice.id} disabled={choice.reason !== null}>
                {choice.name}
              </option>
            ))}
          </select>
          {tools === null ? null : <span>· {tools}</span>}
        </label>
        {reason === null ? null : (
          <span id={reasonId} className="text-muted-foreground block text-xs">
            {reason}
          </span>
        )}
      </span>
    </li>
  );
};

/**
 * The Specialists panel: the chosen specialists (one by default), each with
 * its model as a choice, then "Add a specialist", which opens the others
 * while there is room for one more. At three the button stays, disabled,
 * and says why.
 */
const SpecialistsPanel = (props: PanelProps) => {
  const { state, context, prompt } = props;
  const [adding, setAdding] = useState(false);
  const listId = useId();
  const picks = specialistPicks(state, context, prompt);
  const rows = specialistRows(context.catalog);
  const room = canAddSpecialist(state, context, prompt);
  const others = rows.filter(
    (row) => !picks.some((pick) => specialistOf(pick) === row.id),
  );
  const answering = picks.flatMap((pick) => {
    const row = rows.find(({ id }) => id === specialistOf(pick));
    return row === undefined ? [] : [{ pick, row }];
  });
  return (
    <div className="flex max-h-[18rem] flex-col gap-2 overflow-y-auto overscroll-contain">
      {answering.length === 0 ? null : (
        <fieldset className="min-w-0">
          <legend className="text-eyebrow px-2 pb-1">Answering</legend>
          <ul className="flex flex-col">
            {answering.map(({ pick, row }) => (
              <AnsweringRow key={row.id} pick={pick} row={row} {...props} />
            ))}
          </ul>
        </fieldset>
      )}
      {others.length === 0 ? null : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={!room}
          aria-expanded={room && adding}
          aria-controls={listId}
          onClick={() => setAdding(!adding)}
        >
          {room
            ? adding
              ? "Hide the other specialists"
              : "Add a specialist"
            : "Three specialists at most"}
        </Button>
      )}
      {room && adding ? (
        <div id={listId}>
          <RowGroup legend="Add" rows={others} list="specialists" {...props} />
        </div>
      ) : null}
    </div>
  );
};

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
  const autoModel = autoModelName(context);
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
          <p className="text-xs">
            {autoModel === null ? null : (
              <span className="text-muted-foreground">
                Runs its pick on {autoModel}, with that specialist&rsquo;s tools.{" "}
              </span>
            )}
            <Link href={AGENTS_HREF} className="underline underline-offset-2">
              The specialists Auto picks from
            </Link>
          </p>
        ) : state.mode === "basic" ? (
          <div className="flex max-h-[18rem] flex-col gap-3 overflow-y-auto overscroll-contain">
            <RowGroup
              legend="Model"
              rows={plainModelRows(context.catalog)}
              list="basic"
              {...shared}
            />
          </div>
        ) : state.mode === "specialists" ? (
          <SpecialistsPanel {...shared} />
        ) : (
          <div className="flex max-h-[18rem] flex-col gap-3 overflow-y-auto overscroll-contain">
            <RowGroup
              legend="Specialists"
              rows={specialistRows(context.catalog)}
              list="compare"
              {...shared}
            />
            <RowGroup
              legend="Models"
              rows={plainModelRows(context.catalog)}
              list="compare"
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
