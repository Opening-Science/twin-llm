import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class lists for every component in the app. `clsx` resolves the
 * conditional pieces; `tailwind-merge` then drops any utility that a later
 * entry overrides, so a caller's `className` reliably wins over a default.
 * It sits in `infrastructure` because primitives and features alike use it.
 */
export const cn = (...parts: ClassValue[]): string => twMerge(clsx(...parts));
