"use client";

import type { ComponentProps } from "react";
import { Popover as RadixPopover } from "radix-ui";

import { cn } from "@/infrastructure/ui";

/**
 * A floating panel anchored to a trigger, built on Radix for focus handling,
 * dismissal and positioning.
 *
 * It opens without animation, in line with the design's near-zero motion. The
 * panel itself shows no focus outline when Radix moves focus into it, because
 * a ring around a whole panel reads as an error state; the controls inside
 * keep the normal focus ring.
 */

export const Popover = (props: ComponentProps<typeof RadixPopover.Root>) => (
  <RadixPopover.Root {...props} />
);

export const PopoverTrigger = (props: ComponentProps<typeof RadixPopover.Trigger>) => (
  <RadixPopover.Trigger data-slot="popover-trigger" {...props} />
);

export const PopoverContent = ({
  className,
  align = "start",
  sideOffset = 8,
  ...rest
}: ComponentProps<typeof RadixPopover.Content>) => {
  const panelClasses = cn(
    "z-50 w-72 rounded-xl border border-border bg-popover text-popover-foreground outline-hidden",
    className,
  );
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        className={panelClasses}
        {...rest}
      />
    </RadixPopover.Portal>
  );
};
