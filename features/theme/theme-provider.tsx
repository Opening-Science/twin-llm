"use client";

import { ThemeProvider as NextThemes } from "next-themes";
import type { ReactNode } from "react";

/**
 * Light/dark mode as a `.dark` class on `<html>`, so the in-app toggle can
 * override the system preference. A first visit follows the system setting;
 * after a toggle the choice is remembered. Transitions are suppressed during
 * the switch so colours change at once rather than animating.
 */
export const ThemeProvider = ({ children }: Readonly<{ children: ReactNode }>) => (
  <NextThemes
    attribute="class"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
  >
    {children}
  </NextThemes>
);
