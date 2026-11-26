"use client";

import type { ComponentProps } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/infrastructure/ui";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  container,
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content> & {
  container?: ComponentProps<typeof TooltipPrimitive.Portal>["container"];
}) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "bg-foreground text-background z-50 max-w-60 rounded-md px-3 py-1.5 text-xs shadow-md",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
