import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's own sizes, so it would read the
 * theme's type steps (`text-hero`, `text-insight`, `text-axis`, in
 * globals.css) as text colours and drop one of them next to `text-chart-1`.
 * Naming them as font sizes keeps both.
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["hero", "insight", "axis"] }] } },
});

/**
 * Joins class lists for every component in the app. `clsx` resolves the
 * conditional pieces; `tailwind-merge` then drops any utility that a later
 * entry overrides, so a caller's `className` reliably wins over a default.
 * It sits in `infrastructure` because primitives and features alike use it.
 */
export const cn = (...parts: ClassValue[]): string => twMerge(clsx(...parts));
