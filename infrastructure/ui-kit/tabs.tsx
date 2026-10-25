"use client";

import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/infrastructure/ui";

/**
 * shadcn-style tabs over Radix, from the `radix-ui` package already
 * installed.
 *
 * Tabs are the one control here worth borrowing rather than writing: the
 * tablist/tab/tabpanel wiring, `aria-selected`, `aria-controls` and the
 * roving arrow-key focus are fiddly to get right and easy to get subtly
 * wrong. Buttons that merely look like tabs announce nothing.
 *
 * The selected tab takes the accent underline because choosing a tab is an
 * interactive act; the panel keeps the app-wide focus ring.
 */

export const Tabs = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) => (
  <TabsPrimitive.Root
    data-slot="tabs"
    className={cn("flex flex-col gap-3", className)}
    {...props}
  />
);

export const TabsList = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn("border-border flex gap-1 border-b", className)}
    {...props}
  />
);

export const TabsTrigger = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    data-slot="tabs-trigger"
    className={cn(
      "text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground -mb-px border-b-2 border-transparent px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content data-slot="tabs-content" className={cn(className)} {...props} />
);
