import { Search } from "lucide-react";
import { type Ref } from "react";

import { cn } from "@/infrastructure/ui";
import { Button } from "@/infrastructure/ui-kit/button";

import { YOUR_DAY_COPY } from "../../../twin-page-copy";

const COPY = YOUR_DAY_COPY.chartPicker;
const outline =
  "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2";

export function PickerFilters({
  searchRef,
  query,
  category,
  categories,
  onQueryChange,
  onCategoryChange,
  onEscape,
}: Readonly<{
  searchRef: Ref<HTMLInputElement>;
  query: string;
  category: string;
  categories: readonly string[];
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onEscape: () => void;
}>) {
  return (
    <>
      <label className="relative block">
        <span className="sr-only">{COPY.search}</span>
        <Search
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <input
          ref={searchRef}
          type="search"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onEscape();
            }
          }}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder={COPY.search}
          className={`bg-card border-input w-full rounded-md border py-2 ps-9 pe-3 text-sm ${outline}`}
        />
      </label>
      <div
        role="group"
        aria-label={COPY.category}
        className="mt-2 mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1"
      >
        {["", ...categories].map((item) => (
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
            onClick={() => onCategoryChange(item)}
          >
            {item || COPY.allCategories}
          </Button>
        ))}
      </div>
    </>
  );
}
