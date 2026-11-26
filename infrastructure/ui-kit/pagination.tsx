import type { ComponentProps } from "react";

import { cn } from "@/infrastructure/ui";

import { Button } from "./button";

// Adapted from shadcn/ui Pagination (MIT, see NOTICE) for in-place navigation with buttons.
export function Pagination({ className, ...props }: ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Pagination"
      data-slot="pagination"
      className={cn("flex", className)}
      {...props}
    />
  );
}

export function PaginationContent({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

export function PaginationItem(props: ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

export function PaginationButton({
  isActive,
  className,
  ...props
}: ComponentProps<"button"> & { isActive?: boolean }) {
  return (
    <Button
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-button"
      variant="ghost"
      size="sm"
      className={cn(
        "focus-visible:outline-ring size-7 p-0 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2",
        isActive
          ? "bg-foreground text-background hover:text-background"
          : "text-foreground hover:bg-muted",
        className,
      )}
      {...props}
    />
  );
}
