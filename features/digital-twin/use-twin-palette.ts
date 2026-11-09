"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  BRAND_PALETTE,
  resolveTwinPalette,
  type TwinPalette,
  type TwinTheme,
} from "./twin-palette";

/**
 * The twin's palette for the current theme, read from the tokens on `<html>`.
 *
 * The theme is taken from the `.dark` class itself, not from next-themes'
 * state: next-themes reports the new theme a render before it moves the
 * class, and the custom properties only change with the class. Dark is the
 * twin's home, so the server render assumes it.
 */

const themeNow = (): TwinTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const serverTheme = (): TwinTheme => "dark";

const onThemeChange = (notify: () => void): (() => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
};

export const readDocumentPalette = (theme: TwinTheme): TwinPalette => {
  if (typeof document === "undefined") return BRAND_PALETTE[theme];
  const style = getComputedStyle(document.documentElement);
  return resolveTwinPalette(theme, (token) => style.getPropertyValue(`--${token}`));
};

export const useTwinPalette = (): TwinPalette => {
  const theme = useSyncExternalStore(onThemeChange, themeNow, serverTheme);
  return useMemo(() => readDocumentPalette(theme), [theme]);
};
