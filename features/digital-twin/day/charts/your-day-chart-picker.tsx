"use client";

import { Check, Plus, X } from "lucide-react";
import { animate } from "motion/mini";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/infrastructure/ui";
import { Button } from "@/infrastructure/ui-kit/button";
import { useReducedMotion } from "@/infrastructure/ui-kit/use-reduced-motion";

import { YOUR_DAY_COPY } from "../../twin-page-copy";
import { PickerCard } from "./picker/picker-card";
import { PickerFilters } from "./picker/picker-filters";
import { PickerPagination } from "./picker/picker-pagination";
import {
  MAX_YOUR_DAY_CHARTS,
  toggleYourDayChart,
  type YourDayChartId,
} from "./your-day-charts";
import {
  type buildPickerCatalog,
  filterPickerCatalog,
  paginatePickerCatalog,
} from "./your-day-picker-catalog";

const COPY = YOUR_DAY_COPY.chartPicker;
const outline =
  "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2";
const button = `rounded-md px-3 py-2 text-sm font-medium ${outline}`;
const dialogRest = "none";
const dialogOffset = "translateY(6px) scale(0.98)";

export function YourDayChartPicker({
  catalog,
  active,
  onApply,
}: Readonly<{
  catalog: ReturnType<typeof buildPickerCatalog>;
  active: readonly YourDayChartId[];
  onApply: (ids: readonly YourDayChartId[]) => void;
}>) {
  const id = useId();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const resultsArea = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const pageDirection = useRef<"forward" | "backward" | null>(null);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const closing = useRef(false);
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(active);
  const results = filterPickerCatalog(catalog.entries, query, category);
  const pagination = paginatePickerCatalog(results, page);
  const { entries, pageCount } = pagination;
  const remaining = MAX_YOUR_DAY_CHARTS - draft.length;

  useLayoutEffect(() => {
    const direction = pageDirection.current;
    pageDirection.current = null;
    if (!grid.current || !direction || reducedMotion) return;

    const transition = animate(
      grid.current,
      {
        opacity: [0.35, 1],
        translate: [direction === "forward" ? "12px" : "-12px", "none"],
      },
      { duration: 0.18, ease: "easeOut" },
    );
    return () => transition.cancel();
  }, [page, query, category, reducedMotion]);

  function changePage(target: number) {
    if (target === page || closing.current) return;
    pageDirection.current = target > page ? "forward" : "backward";
    resultsArea.current?.scrollTo({ top: 0, behavior: "instant" });
    setPage(target);
  }

  function open() {
    if (!dialog || dialog.open || closing.current) return;
    setDraft(active);
    setQuery("");
    setCategory("");
    setPage(0);
    dialog.showModal();
    if (!reducedMotion) {
      animation.current = animate(
        dialog,
        { opacity: [0, 1], transform: [dialogOffset, dialogRest] },
        { duration: 0.18, ease: "easeOut" },
      );
    }
    search.current?.focus();
  }

  function close() {
    if (!dialog?.open || closing.current) return;
    closing.current = true;
    if (reducedMotion) {
      dialog.close();
      return;
    }

    animation.current?.stop();
    // Keep the native top layer and focus trap until the exit finishes.
    const exit = animate(
      dialog,
      { opacity: 0, transform: dialogOffset },
      { duration: 0.14, ease: "easeIn" },
    );
    animation.current = exit;
    void exit.then(() => {
      if (animation.current === exit && dialog.open) dialog.close();
    });
  }

  function toggleChart(chartId: YourDayChartId) {
    setDraft((ids) => toggleYourDayChart(ids, chartId));
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-controls={id}
        className={`dark border-input bg-card text-foreground hover:bg-muted inline-flex shrink-0 items-center gap-2 border whitespace-nowrap ${button}`}
        onClick={open}
      >
        <Plus aria-hidden="true" className="size-4" />
        {COPY.open}
      </button>
      <dialog
        ref={setDialog}
        id={id}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-intro`}
        className="dark border-border bg-background text-foreground m-auto h-[calc(100dvh-20rem)] max-h-none w-[calc(100%-1.5rem)] max-w-4xl flex-col overflow-hidden rounded-2xl border p-0 shadow-xl backdrop:bg-black/55 backdrop:backdrop-blur-xs open:flex sm:h-[calc(100dvh-clamp(3rem,12dvh,8rem))]"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={(event) => {
          animation.current?.cancel();
          animation.current = null;
          closing.current = false;
          event.currentTarget.style.removeProperty("opacity");
          event.currentTarget.style.removeProperty("transform");
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1 px-4 pt-4 pb-2 sm:px-6 sm:pt-5">
          <h2
            id={`${id}-title`}
            className="me-auto min-w-0 text-lg font-semibold sm:text-xl"
          >
            {COPY.title}
          </h2>
          <span
            aria-hidden="true"
            className="bg-muted text-foreground mt-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums"
          >
            {COPY.selectedBadge(draft.length, MAX_YOUR_DAY_CHARTS)}
          </span>
          <button
            type="button"
            aria-label={COPY.close}
            onClick={close}
            className={`hover:bg-muted grid size-8 shrink-0 place-items-center rounded-md ${outline}`}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
          <p id={`${id}-intro`} className="text-muted-foreground w-full text-sm">
            {COPY.intro(MAX_YOUR_DAY_CHARTS)}
          </p>
        </header>
        <div
          ref={resultsArea}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-2 pb-3 sm:px-6"
        >
          <PickerFilters
            searchRef={search}
            query={query}
            category={category}
            categories={catalog.categories}
            onQueryChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
            onCategoryChange={(value) => {
              setCategory(value);
              setPage(0);
            }}
            onEscape={close}
          />
          {results.length === 0 ? (
            <p role="status" className="text-muted-foreground py-6 text-center text-sm">
              {COPY.noMatches}
            </p>
          ) : (
            <ul
              ref={grid}
              className={cn(
                "grid auto-rows-(--picker-card-height) gap-3 [--picker-card-height:9rem] sm:grid-cols-2 md:grid-cols-3",
                // Reserve the same rows on a partial last page so the controls stay put.
                pageCount > 1 &&
                  "grid-rows-[repeat(9,var(--picker-card-height))] sm:grid-rows-[repeat(5,var(--picker-card-height))] md:grid-rows-[repeat(3,var(--picker-card-height))]",
              )}
            >
              {entries.map((entry) => (
                <PickerCard
                  key={entry.id}
                  entry={entry}
                  dialogId={id}
                  dialog={dialog}
                  checked={entry.chartId !== null && draft.includes(entry.chartId)}
                  atLimit={remaining === 0}
                  onToggle={toggleChart}
                />
              ))}
            </ul>
          )}
        </div>
        {results.length > 0 && (
          <PickerPagination
            pagination={pagination}
            page={page}
            resultCount={results.length}
            onPageChange={changePage}
          />
        )}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pt-2 pb-4 sm:px-6 sm:pb-5">
          <p aria-live="polite" className="text-xs">
            <span className="block font-medium">
              {COPY.selected(draft.length, MAX_YOUR_DAY_CHARTS)}
            </span>
            <span className="text-muted-foreground mt-0.5 block">
              {remaining === 0 ? COPY.limitReached : COPY.remaining(remaining)}
            </span>
          </p>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button onClick={close} className={outline}>
              {COPY.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (closing.current) return;
                onApply(draft);
                close();
              }}
              className={`bg-foreground text-background hover:bg-foreground/85 ${outline}`}
            >
              <Check aria-hidden="true" className="size-4" />
              {COPY.apply}
            </Button>
          </div>
        </footer>
      </dialog>
    </>
  );
}
