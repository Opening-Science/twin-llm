import type { ComponentProps } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * One button, four looks.
 *
 * The same outline-button class string had been copied into a dozen screens
 * with small drifts (one with hover, one without, one rounder), which is how a
 * design system dies quietly. This is the one place those classes live now.
 *
 * `buttonClassName` exists because some buttons are links: a `<Link>` or an
 * `<a>` in a server component should look like a button without becoming one,
 * and without dragging in a Slot/`asChild` layer for a single string.
 *
 * `type` defaults to "button". A bare `<button>` inside a form submits it,
 * which is never what a secondary action means.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "pill";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "rounded-md px-2.5 py-1 text-xs",
  md: "rounded-lg px-3 py-1.5 text-sm",
};

const VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border-input hover:bg-muted border",
  ghost: "text-muted-foreground hover:text-foreground",
  pill: "border-input hover:bg-muted rounded-full border",
};

export type ButtonStyle = Readonly<{
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}>;

export const buttonClassName = ({
  variant = "secondary",
  size = "md",
  className,
}: ButtonStyle = {}): string => cn(BASE, SIZE[size], VARIANT[variant], className);

export type ButtonProps = Readonly<
  Omit<ComponentProps<"button">, "className"> & ButtonStyle
>;

export const Button = ({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={buttonClassName({ variant, size, className })}
    {...props}
  />
);
