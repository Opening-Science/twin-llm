import { wrapFocus } from "./environment-state";

/**
 * Keeps Tab inside the open environment. The listener sits on the document,
 * not the container: a drag on the canvas can leave focus on `<body>`, and a
 * container listener would never hear the next Tab, which then lands in the
 * page behind the overlay. Focus outside the container counts as "before the
 * first control", so Tab pulls it back in.
 *
 * The document and the container are passed in, so the trap is testable
 * without a browser.
 */

export type Focusable = Readonly<{ focus: () => void }>;

export type TrapContainer = Readonly<{
  /** The visible, enabled controls inside, in tab order. */
  focusables: () => readonly Focusable[];
  focus: () => void;
}>;

export type TabEvent = Readonly<{
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}>;

export type TrapDocument = Readonly<{
  activeElement: unknown;
  addEventListener: (
    type: "keydown",
    listener: (event: TabEvent) => void,
    capture: boolean,
  ) => void;
  removeEventListener: (
    type: "keydown",
    listener: (event: TabEvent) => void,
    capture: boolean,
  ) => void;
}>;

export const onTrapKey = (
  event: TabEvent,
  doc: Pick<TrapDocument, "activeElement">,
  container: TrapContainer,
): void => {
  if (event.key !== "Tab") return;
  const focusable = container.focusables();
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  // -1 for focus outside the container, or on the container itself.
  const index = focusable.findIndex((element) => element === doc.activeElement);
  const next = wrapFocus(index, focusable.length, event.shiftKey);
  if (next === null) return;
  event.preventDefault();
  focusable[next]?.focus();
};

/** Starts the trap; returns the function that stops it. */
export const installTabTrap = (doc: TrapDocument, container: TrapContainer) => {
  const listener = (event: TabEvent) => onTrapKey(event, doc, container);
  // Capture, so no handler inside the page can stop it first.
  doc.addEventListener("keydown", listener, true);
  return () => doc.removeEventListener("keydown", listener, true);
};
