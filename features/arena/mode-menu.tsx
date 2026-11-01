"use client";

import {
  AUTO_MODEL_ID,
  type CatalogModel,
  findCatalogRow,
  formatModelWindow,
  MAX_SELECTED_MODELS,
} from "@/infrastructure/model-catalog";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import {
  CHAT_MODES,
  type ChatMode,
  MODE_COPY,
  modeModelIds,
  modeProblem,
  modeSummary,
  type ModeSelection,
  plainModels,
  specialistRows,
  toggleCompare,
  toggleManual,
} from "./chat-mode";
import { menuSubline } from "./model-selection";

/**
 * The mode and model picker of the prompt bar (#366): Auto, Manual or
 * Compare first, then what that mode lets the person pick, as real
 * checkboxes. A box that would break the mode's rule (three answers at most,
 * one model at least) is disabled and the line under the lists says why. A
 * locked row (a model an incognito chat may not use) is disabled with its
 * reason on the row. The words are "specialists", never doctors: they are
 * research agents that describe data (docs/clinical-research.md).
 */

type Row = Readonly<{
  model: CatalogModel;
  checked: boolean;
  /** The box cannot change, for the mode's rule. */
  blocked: boolean;
  locked: boolean;
  onToggle: () => void;
}>;

const CheckRow = ({ row, lockedNote }: Readonly<{ row: Row; lockedNote: string }>) => {
  const disabled = row.locked || row.blocked;
  return (
    <li>
      <label
        className={
          disabled
            ? "flex cursor-not-allowed items-center gap-3 px-4 py-2 opacity-50"
            : "hover:bg-muted flex cursor-pointer items-center gap-3 px-4 py-2"
        }
      >
        <input
          type="checkbox"
          checked={row.checked}
          disabled={disabled}
          onChange={row.onToggle}
          className="accent-primary size-4 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{row.model.name}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {menuSubline(row.model)}
          </span>
          {row.locked ? (
            <span className="text-muted-foreground block text-xs">{lockedNote}</span>
          ) : null}
        </span>
        <span className="metric">{formatModelWindow(row.model)}</span>
      </label>
    </li>
  );
};

const Group = ({
  label,
  rows,
  lockedNote,
}: Readonly<{ label: string; rows: readonly Row[]; lockedNote: string }>) =>
  rows.length === 0 ? null : (
    <fieldset>
      <legend className="text-eyebrow px-4 pt-2 pb-1">{label}</legend>
      <ul>
        {rows.map((row) => (
          <CheckRow key={row.model.id} row={row} lockedNote={lockedNote} />
        ))}
      </ul>
    </fieldset>
  );

export const ModeMenu = ({
  catalog,
  selection,
  lockedIds = [],
  lockedNote = "",
  onChange,
}: Readonly<{
  catalog: readonly CatalogModel[];
  selection: ModeSelection;
  /** Rows that cannot be chosen here at all, with `lockedNote` saying why. */
  lockedIds?: readonly string[];
  lockedNote?: string;
  onChange: (selection: ModeSelection) => void;
}>) => {
  const offered = catalog.filter((row) => !lockedIds.includes(row.id));
  const autoOffered = findCatalogRow(AUTO_MODEL_ID, offered) !== null;
  const modes = CHAT_MODES.filter((mode) => mode !== "auto" || autoOffered);
  const answers = modeModelIds(selection, offered).length;
  const problem = modeProblem(selection, offered);
  const row = (model: CatalogModel, checked: boolean, next: () => ModeSelection): Row => {
    const locked = lockedIds.includes(model.id);
    const changed = next();
    return {
      model,
      checked,
      locked,
      blocked: !locked && changed === selection,
      onToggle: () => onChange(changed),
    };
  };
  const specialistIdOf = (model: CatalogModel) => model.agent?.id ?? model.id;

  return (
    <Popover>
      <PopoverTrigger
        className={buttonClassName({ variant: "pill", size: "sm", className: "gap-1" })}
        aria-label={`Mode and models: ${modeSummary(selection, offered)}`}
      >
        <span className="truncate">{modeSummary(selection, offered)}</span>
        <ChevronIcon className="size-3 rotate-90" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        collisionPadding={16}
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex flex-col gap-2 px-4 pt-3 pb-2">
          <SegmentedControl<ChatMode>
            label="Mode"
            size="sm"
            options={modes.map((mode) => ({ value: mode, label: MODE_COPY[mode].label }))}
            value={selection.mode}
            onChange={(mode) => onChange({ ...selection, mode })}
          />
          <p className="text-muted-foreground text-xs">
            {MODE_COPY[selection.mode].line}
          </p>
        </div>
        {selection.mode === "auto" ? (
          <p className="text-muted-foreground border-border border-t px-4 py-3 text-xs">
            Specialists Auto can pick here:{" "}
            {specialistRows(offered)
              .map((model) => model.name)
              .join(", ")}
            . Each describes data in its area, for research only.
          </p>
        ) : (
          <div className="border-border max-h-72 overflow-y-auto border-y py-1">
            {selection.mode === "manual" ? (
              <>
                <Group
                  label="Specialists"
                  lockedNote={lockedNote}
                  rows={specialistRows(catalog).map((model) =>
                    row(
                      model,
                      selection.specialists.includes(specialistIdOf(model)),
                      () => toggleManual(selection, "specialists", specialistIdOf(model)),
                    ),
                  )}
                />
                <Group
                  label="Models"
                  lockedNote={lockedNote}
                  rows={plainModels(catalog).map((model) =>
                    row(model, selection.models.includes(model.id), () =>
                      toggleManual(selection, "models", model.id),
                    ),
                  )}
                />
              </>
            ) : (
              <>
                <Group
                  label="Specialists"
                  lockedNote={lockedNote}
                  rows={specialistRows(catalog).map((model) =>
                    row(model, selection.compare.includes(model.id), () =>
                      toggleCompare(selection, model.id, offered),
                    ),
                  )}
                />
                <Group
                  label="Models"
                  lockedNote={lockedNote}
                  rows={plainModels(catalog).map((model) =>
                    row(model, selection.compare.includes(model.id), () =>
                      toggleCompare(selection, model.id, offered),
                    ),
                  )}
                />
              </>
            )}
          </div>
        )}
        <p className="text-muted-foreground px-4 py-3 text-xs">
          {problem ??
            (selection.mode === "auto"
              ? "One answer per prompt."
              : `${String(answers)} of at most ${String(MAX_SELECTED_MODELS)} answers.`)}
        </p>
      </PopoverContent>
    </Popover>
  );
};
