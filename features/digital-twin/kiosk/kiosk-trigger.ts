/**
 * What starts and moves the kiosk on: a trigger sends an input (a press, a
 * step back, or a reset) each time one happens and returns a function that
 * stops listening. The screen itself is one (a press anywhere on it,
 * `kiosk-screen.tsx`); the keyboard is another, for a desk test, a USB button
 * that sends a key, or staff resetting the screen. The light ring on the
 * kiosk's stand will be a third, with the same shape, once its connection is
 * decided.
 */

export type KioskInput = "press" | "back" | "reset";

export type KioskTrigger = (send: (input: KioskInput) => void) => () => void;

/**
 * The keys the keyboard trigger reads: Space and Enter press, the arrows
 * step, Escape sends the kiosk back to the start.
 */
export const keyPress = (key: string): KioskInput | null =>
  key === " " || key === "Enter" || key === "ArrowRight" || key === "ArrowDown"
    ? "press"
    : key === "ArrowLeft" || key === "ArrowUp"
      ? "back"
      : key === "Escape"
        ? "reset"
        : null;

/**
 * Space, Enter, the arrows and Escape on the window. A held key sends once;
 * on a focused button Space and Enter are left to the button, which clicks.
 */
export const keyboardTrigger: KioskTrigger = (send) => {
  const onKey = (event: KeyboardEvent) => {
    const kind = keyPress(event.key);
    if (kind === null || event.repeat) return;
    if (
      event.target instanceof HTMLButtonElement &&
      (event.key === " " || event.key === "Enter")
    )
      return;
    event.preventDefault();
    send(kind);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
};
