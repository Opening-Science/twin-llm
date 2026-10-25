/**
 * "How to move" is open on the first visit and collapsed after that, unless
 * the person left it open. Storage can be missing or throw (private mode,
 * blocked site data); then the help simply opens and nothing is remembered.
 */
export const HELP_KEY = "twinllm.environment.how-to-move";

export type HelpStorage = Pick<Storage, "getItem" | "setItem">;

export const readHelpOpen = (storage: HelpStorage | null): boolean => {
  try {
    return (storage?.getItem(HELP_KEY) ?? null) !== "closed";
  } catch {
    return true;
  }
};

export const saveHelpOpen = (storage: HelpStorage | null, open: boolean): void => {
  try {
    storage?.setItem(HELP_KEY, open ? "open" : "closed");
  } catch {
    // Not remembered; the next visit opens it again.
  }
};

/** After the first visit the help starts collapsed. */
export const rememberFirstVisit = (storage: HelpStorage | null): void => {
  try {
    if (storage?.getItem(HELP_KEY) === null) storage.setItem(HELP_KEY, "closed");
  } catch {
    // As above.
  }
};

/** `window.localStorage` itself throws when site data is blocked. */
export const browserStorage = (): HelpStorage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
