"use client";

import { MAX_SELECTED_MODELS, type CatalogModel } from "@/infrastructure/model-catalog";
import { formatModelWindow } from "@/infrastructure/model-catalog";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";

import { chosenModels, toggleLimit } from "./model-selection";

/**
 * The list of every model the provider offers, as real checkboxes: picking a
 * model is a yes/no choice per row, and a checkbox says that to a screen reader
 * without any extra ARIA. A row that would break the 1-to-3 rule is disabled,
 * and the line under the list says why in words.
 */

const LIMIT_NOTE = {
  cap: "Three is the most one prompt can go to. Untick one to choose another.",
  floor: "One model has to stay. Tick another before you untick this one.",
  open: "Tick up to three. The context window is on the right.",
} as const;

export const ModelMenu = ({
  catalog,
  selectedIds,
  onToggle,
}: Readonly<{
  catalog: readonly CatalogModel[];
  selectedIds: readonly string[];
  onToggle: (modelId: string) => void;
}>) => {
  const count = chosenModels(catalog, selectedIds).length;
  const note =
    count >= MAX_SELECTED_MODELS
      ? LIMIT_NOTE.cap
      : count <= 1
        ? LIMIT_NOTE.floor
        : LIMIT_NOTE.open;

  return (
    <Popover>
      <PopoverTrigger className={buttonClassName({ variant: "pill", size: "sm" })}>
        {count >= MAX_SELECTED_MODELS ? "Change models" : "Add model"}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        collisionPadding={16}
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
      >
        <fieldset>
          <legend className="text-eyebrow flex w-full justify-between px-4 pt-3 pb-2">
            <span>Models for this prompt</span>
            <span className="font-mono">
              {count}/{MAX_SELECTED_MODELS}
            </span>
          </legend>
          <ul className="border-border max-h-72 overflow-y-auto border-y py-1">
            {catalog.map((model) => {
              const selected = selectedIds.includes(model.id);
              const blocked = toggleLimit(selected, count) !== null;
              return (
                <li key={model.id}>
                  <label
                    className={
                      blocked
                        ? "flex cursor-not-allowed items-center gap-3 px-4 py-2 opacity-50"
                        : "hover:bg-muted flex cursor-pointer items-center gap-3 px-4 py-2"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={blocked}
                      onChange={() => onToggle(model.id)}
                      className="accent-primary size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{model.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {model.provider}
                      </span>
                    </span>
                    <span className="metric">{formatModelWindow(model)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="text-muted-foreground px-4 py-3 text-xs">{note}</p>
      </PopoverContent>
    </Popover>
  );
};
