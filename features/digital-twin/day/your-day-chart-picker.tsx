"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Info,
  Plus,
  Search,
  X,
} from "lucide-react";
import { animate } from "motion/mini";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/infrastructure/ui";
import { Button } from "@/infrastructure/ui-kit/button";
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationItem,
} from "@/infrastructure/ui-kit/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { useReducedMotion } from "@/infrastructure/ui-kit/use-reduced-motion";

import { YOUR_DAY_COPY } from "../twin-page-copy";

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
const card =
  "border-input bg-card relative flex h-full w-full items-start justify-between gap-2 rounded-xl border p-3 text-start";
const indicator = "grid size-5 shrink-0 place-items-center rounded border";
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
  const { entries, firstResult, lastResult, pageCount, visiblePages } =
    paginatePickerCatalog(results, page);
  const remaining = MAX_YOUR_DAY_CHARTS - draft.length;
  const backward = [
    { label: COPY.firstPage, target: 0, icon: ChevronsLeft },
    { label: COPY.previousPage, target: page - 1, icon: ChevronLeft },
  ];
  const forward = [
    { label: COPY.nextPage, target: page + 1, icon: ChevronRight },
    { label: COPY.lastPage, target: pageCount - 1, icon: ChevronsRight },
  ];

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
          <label className="relative block">
            <span className="sr-only">{COPY.search}</span>
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            />
            <input
              ref={search}
              type="search"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
              }}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setPage(0);
              }}
              placeholder={COPY.search}
              className={`bg-card border-input w-full rounded-md border py-2 ps-9 pe-3 text-sm ${outline}`}
            />
          </label>
          <div
            role="group"
            aria-label={COPY.category}
            className="mt-2 mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1"
          >
            {["", ...catalog.categories].map((item) => (
              <Button
                key={item}
                variant="ghost"
                size="sm"
                aria-pressed={category === item}
                className={cn(
                  "rounded-full",
                  outline,
                  category === item
                    ? "bg-foreground text-background hover:text-background"
                    : "bg-muted hover:bg-muted/70",
                )}
                onClick={() => {
                  setCategory(item);
                  setPage(0);
                }}
              >
                {item || COPY.allCategories}
              </Button>
            ))}
          </div>
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
              {entries.map((entry) => {
                const {
                  id: entryId,
                  chartId,
                  label,
                  provider,
                  description,
                  unit,
                } = entry;
                const checked = chartId !== null && draft.includes(chartId);
                const nameId = `${id}-${entryId}-label`;
                const detailsId = `${id}-${entryId}-details`;
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
                      <span className="mt-1 line-clamp-2 leading-snug">
                        {description}
                      </span>
                    </span>
                  </span>
                );
                if (chartId === null || (!checked && remaining === 0)) {
                  const reason =
                    chartId === null
                      ? (entry.unavailableReason ?? COPY.noSeries)
                      : COPY.full;
                  return (
                    <li key={entryId} className={`${card} text-muted-foreground`}>
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
                          className={`${indicator} ${outline} border-input text-foreground hover:bg-muted size-7 cursor-pointer`}
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
                  <li key={entryId}>
                    <label
                      className={`${card} hover:bg-muted has-checked:border-foreground has-checked:inset-ring-foreground focus-within:outline-ring cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 has-checked:inset-ring-1`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-labelledby={nameId}
                        aria-describedby={detailsId}
                        onChange={() =>
                          setDraft((ids) => toggleYourDayChart(ids, chartId))
                        }
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
                        {checked ? (
                          <Check className="size-3" />
                        ) : (
                          <Plus className="size-3" />
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {results.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
            {pageCount > 1 && (
              <Pagination aria-label={COPY.pages}>
                <PaginationContent>
                  {backward.map(({ label, target, icon: Icon }) => (
                    <PaginationItem key={label}>
                      <PaginationButton
                        aria-label={label}
                        disabled={page === 0}
                        onClick={() => changePage(target)}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                      </PaginationButton>
                    </PaginationItem>
                  ))}
                  {visiblePages.map((target) => (
                    <PaginationItem key={target}>
                      <PaginationButton
                        isActive={target === page}
                        aria-label={COPY.page(target + 1)}
                        className={cn("transition-none", target !== page && "bg-muted")}
                        onClick={() => changePage(target)}
                      >
                        {target + 1}
                      </PaginationButton>
                    </PaginationItem>
                  ))}
                  {forward.map(({ label, target, icon: Icon }) => (
                    <PaginationItem key={label}>
                      <PaginationButton
                        aria-label={label}
                        disabled={page === pageCount - 1}
                        onClick={() => changePage(target)}
                      >
                        <Icon aria-hidden="true" className="size-4" />
                      </PaginationButton>
                    </PaginationItem>
                  ))}
                </PaginationContent>
              </Pagination>
            )}
            <p
              role="status"
              className="text-muted-foreground ms-auto text-xs tabular-nums"
            >
              {COPY.showing(firstResult, lastResult, results.length)}
            </p>
          </div>
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
