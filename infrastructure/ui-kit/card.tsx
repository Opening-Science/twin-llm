import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * A `.surface` with one of three fixed padding steps.
 *
 * Cards had been drawn by hand as `border rounded-xl px-4 py-4`, which skipped
 * the card background `.surface` gives and let padding drift per screen.
 * Fixed steps keep a row of cards visually aligned without anyone measuring.
 *
 * The element is a choice of three, not an open polymorphic `as`, because
 * those are the only honest semantics for a card here and a closed set keeps
 * the props strictly typed.
 */

export type CardPadding = "sm" | "md" | "lg";

const PADDING: Readonly<Record<CardPadding, string>> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export type CardProps = Readonly<{
  as?: "article" | "section" | "div";
  padding?: CardPadding;
  className?: string;
  children: ReactNode;
}>;

export const Card = ({
  as: Element = "div",
  padding = "md",
  className,
  children,
}: CardProps) => (
  <Element className={cn("surface", PADDING[padding], className)}>{children}</Element>
);
