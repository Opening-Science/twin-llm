/**
 * What starts and moves the kiosk on: a trigger calls `onPress` once per
 * press and returns a function that stops listening. The screen itself is
 * one (a press anywhere on it, `kiosk-screen.tsx`); the keyboard is another,
 * for a desk test or a USB button that sends a key. The light ring on the
 * kiosk's stand will be a third, with the same shape, once its connection
 * is decided.
 */

export type KioskTrigger = (onPress: () => void, onBack: () => void) => () => void;

/** The keys the keyboard trigger reads: Space and Enter press, the arrows step. */
export const keyPress = (key: string): "press" | "back" | null =>
  key === " " || key === "Enter" || key === "ArrowRight" || key === "ArrowDown"
    ? "press"
    : key === "ArrowLeft" || key === "ArrowUp"
      ? "back"
      : null;

/**
 * Space, Enter and the arrows on the window. A held key presses once; on a
 * focused button Space and Enter are left to the button, which clicks.
 */
export const keyboardTrigger: KioskTrigger = (onPress, onBack) => {
  const onKey = (event: KeyboardEvent) => {
    const kind = keyPress(event.key);
    if (kind === null || event.repeat) return;
    if (
      event.target instanceof HTMLButtonElement &&
      (event.key === " " || event.key === "Enter")
    )
      return;
    event.preventDefault();
    if (kind === "press") onPress();
    else onBack();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
};
