/**
 * Which collapsible panels a viewer has open, kept in this browser's
 * localStorage. Storage can be missing or throw (private mode, blocked site
 * data); the panels then still open and close, from memory, for this page
 * view only. Nothing here is personal: a key names a panel, the value is
 * "open" or "closed".
 *
 * The store is a small external store for `useSyncExternalStore`, so every
 * panel with the same key agrees, and a change in another tab is picked up.
 */
export const PANEL_KEY_PREFIX = "twinllm.panel.";

export type PanelStorage = Pick<Storage, "getItem" | "setItem">;

export const panelKey = (id: string): string => `${PANEL_KEY_PREFIX}${id}`;

/** The stored choice, or `fallback` when there is none or storage throws. */
export const readPanelOpen = (
  storage: PanelStorage | null,
  key: string,
  fallback: boolean,
): boolean => {
  try {
    const value = storage?.getItem(key) ?? null;
    return value === "open" ? true : value === "closed" ? false : fallback;
  } catch {
    return fallback;
  }
};

/** Returns whether the choice was stored. */
export const savePanelOpen = (
  storage: PanelStorage | null,
  key: string,
  open: boolean,
): boolean => {
  if (!storage) return false;
  try {
    storage.setItem(key, open ? "open" : "closed");
    return true;
  } catch {
    return false;
  }
};

export type PanelStore = Readonly<{
  get: (key: string, fallback: boolean) => boolean;
  set: (key: string, open: boolean) => void;
  /** Another tab wrote this key: storage is the truth again. */
  forget: (key: string) => void;
  subscribe: (listener: () => void) => () => void;
}>;

/**
 * Storage first; a choice that could not be stored is kept in memory, so a
 * toggle always works even where storage is blocked.
 */
export const createPanelStore = (storage: () => PanelStorage | null): PanelStore => {
  const memory = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: (key, fallback) => memory.get(key) ?? readPanelOpen(storage(), key, fallback),
    set: (key, open) => {
      if (savePanelOpen(storage(), key, open)) memory.delete(key);
      else memory.set(key, open);
      notify();
    },
    forget: (key) => {
      memory.delete(key);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** `window.localStorage` itself throws when site data is blocked. */
export const browserPanelStorage = (): PanelStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};
