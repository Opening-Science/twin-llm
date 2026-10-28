"use client";

import { useCallback, useId, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

import { browserPanelStorage, createPanelStore, panelKey } from "./panel-memory";

/**
 * A panel whose body folds away under its title. The title is a real button
 * (Enter and Space toggle it, Tab reaches it) that says whether the body is
 * expanded and which element it controls. The body stays mounted while
 * hidden, so the controls inside keep their state.
 *
 * Controlled: the caller owns `open`. `usePanelOpen` is the usual owner: it
 * remembers the choice per panel in this browser. The look lives in
 * globals.css (`.collapsible-panel`), so every collapsible panel matches.
 */
export type CollapsiblePanelProps = Readonly<{
  label: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}>;

export const CollapsiblePanel = ({
  label,
  open,
  onToggle,
  className,
  children,
}: CollapsiblePanelProps) => {
  const bodyId = useId();
  return (
    <div className={cn("collapsible-panel", className)} data-open={open ? "" : undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="collapsible-panel-toggle"
      >
        <span>{label}</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      <div id={bodyId} hidden={!open} className="collapsible-panel-body">
        {children}
      </div>
    </div>
  );
};

const store = createPanelStore(browserPanelStorage);

/** Another tab changed a panel: drop what this tab kept in memory for it. */
const subscribe = (listener: () => void) => {
  const off = store.subscribe(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key) store.forget(event.key);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    off();
    window.removeEventListener("storage", onStorage);
  };
};

/**
 * Whether panel `id` is open, its toggle, and a setter for code that must
 * show the panel. Remembered in localStorage per viewer; the server render
 * and first paint use `defaultOpen`.
 */
export const usePanelOpen = (
  id: string,
  defaultOpen = true,
): readonly [boolean, () => void, (open: boolean) => void] => {
  const key = panelKey(id);
  const open = useSyncExternalStore(
    subscribe,
    () => store.get(key, defaultOpen),
    () => defaultOpen,
  );
  const toggle = useCallback(
    () => store.set(key, !store.get(key, defaultOpen)),
    [key, defaultOpen],
  );
  const setOpen = useCallback((next: boolean) => store.set(key, next), [key]);
  return [open, toggle, setOpen];
};
