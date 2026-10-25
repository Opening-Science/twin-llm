"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * A round button that flips between light and dark.
 *
 * The resolved theme is only known in the browser, so the server render (and
 * the first client render) shows an empty placeholder of the same size; the
 * icon appears after hydration without shifting anything around it.
 */

const ICON = {
  // Sun: shown in dark mode, offers light.
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  // Crescent: shown in light mode, offers dark.
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
} as const;

const ICON_SVG_PROPS = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const noSubscription = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

/** False during server render and hydration, true once mounted. */
const useHydrated = (): boolean =>
  useSyncExternalStore(noSubscription, inBrowser, onServer);

export const ThemeToggle = ({ className }: Readonly<{ className?: string }>) => {
  const theme = useTheme();
  const hydrated = useHydrated();
  const shell = cn(
    "inline-flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-input hover:text-foreground",
    className,
  );

  if (!hydrated) return <span aria-hidden className={shell} />;

  const target = theme.resolvedTheme === "dark" ? "light" : "dark";
  const flip = () => theme.setTheme(target);
  return (
    <button
      type="button"
      className={shell}
      aria-label={`Switch to ${target} theme`}
      onClick={flip}
    >
      <svg {...ICON_SVG_PROPS} className="h-4 w-4">
        {ICON[target]}
      </svg>
    </button>
  );
};
