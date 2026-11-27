import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/infrastructure/ui";
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationItem,
} from "@/infrastructure/ui-kit/pagination";

import { YOUR_DAY_COPY } from "../../../twin-page-copy";
import { type paginatePickerCatalog } from "../your-day-picker-catalog";

const COPY = YOUR_DAY_COPY.chartPicker;

export function PickerPagination({
  pagination: { pageCount, visiblePages, firstResult, lastResult },
  page,
  resultCount,
  onPageChange,
}: Readonly<{
  pagination: Omit<ReturnType<typeof paginatePickerCatalog>, "entries">;
  page: number;
  resultCount: number;
  onPageChange: (page: number) => void;
}>) {
  const backward = [
    { label: COPY.firstPage, target: 0, icon: ChevronsLeft },
    { label: COPY.previousPage, target: page - 1, icon: ChevronLeft },
  ];
  const forward = [
    { label: COPY.nextPage, target: page + 1, icon: ChevronRight },
    { label: COPY.lastPage, target: pageCount - 1, icon: ChevronsRight },
  ];
  function pageButtons(
    buttons: readonly { label: string; target: number; icon: LucideIcon }[],
    disabled: boolean,
  ) {
    return buttons.map(({ label, target, icon: Icon }) => (
      <PaginationItem key={label}>
        <PaginationButton
          aria-label={label}
          disabled={disabled}
          onClick={() => onPageChange(target)}
        >
          <Icon aria-hidden="true" className="size-4" />
        </PaginationButton>
      </PaginationItem>
    ));
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
      {pageCount > 1 && (
        <Pagination aria-label={COPY.pages}>
          <PaginationContent>
            {pageButtons(backward, page === 0)}
            {visiblePages.map((target) => (
              <PaginationItem key={target}>
                <PaginationButton
                  isActive={target === page}
                  aria-label={COPY.page(target + 1)}
                  className={cn("transition-none", target !== page && "bg-muted")}
                  onClick={() => onPageChange(target)}
                >
                  {target + 1}
                </PaginationButton>
              </PaginationItem>
            ))}
            {pageButtons(forward, page === pageCount - 1)}
          </PaginationContent>
        </Pagination>
      )}
      <p role="status" className="text-muted-foreground ms-auto text-xs tabular-nums">
        {COPY.showing(firstResult, lastResult, resultCount)}
      </p>
    </div>
  );
}
