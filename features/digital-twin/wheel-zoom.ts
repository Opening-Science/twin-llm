"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Over the inline view a plain wheel scrolls the page. OrbitControls would
 * otherwise zoom toward the cursor and move its target, so scrolling past the
 * canvas left the body off-centre, and the environment opened that way.
 * Zooming needs the view focused (a click) or Ctrl/⌘ held, which is also what
 * a trackpad pinch sends. Inside the environment there is no page to scroll.
 */
export const WHEEL_ZOOM_HINT = "Ctrl/⌘ + scroll, or click the view, to zoom";
export const HINT_MS = 2500;

export type WheelInput = Readonly<{
  inEnvironment: boolean;
  focused: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}>;

export const wheelZooms = ({ inEnvironment, focused, ctrlKey, metaKey }: WheelInput) =>
  inEnvironment || focused || ctrlKey || metaKey;

export type WheelLike = Pick<WheelEvent, "ctrlKey" | "metaKey" | "stopPropagation">;

/**
 * The inline wheel handler with its effects passed in, so it is testable
 * without a DOM. Whether it was hinted lives with the caller: the hint shows
 * once per page view, not once per listener.
 */
export const createWheelGate = (
  deps: Readonly<{
    focused: () => boolean;
    hinted: () => boolean;
    markHinted: () => void;
    setHint: (shown: boolean) => void;
    /** Runs `done` after `ms`; returns the cancel. */
    later: (done: () => void, ms: number) => () => void;
  }>,
) => {
  let cancel: (() => void) | null = null;
  const onWheel = (event: WheelLike) => {
    const input = {
      inEnvironment: false,
      focused: deps.focused(),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    };
    if (wheelZooms(input)) return;
    // Capture on the wrapper runs before the canvas listener. No preventDefault,
    // so the browser still scrolls the page.
    event.stopPropagation();
    if (deps.hinted()) return;
    deps.markHinted();
    deps.setHint(true);
    cancel = deps.later(() => deps.setHint(false), HINT_MS);
  };
  // Entering the environment (or leaving the page) takes a showing hint with it.
  const dispose = () => {
    cancel?.();
    deps.setHint(false);
  };
  return { onWheel, dispose };
};

const browserLater = (done: () => void, ms: number) => {
  const timer = window.setTimeout(done, ms);
  return () => window.clearTimeout(timer);
};

/** Keeps a plain wheel away from the controls; true while the one-time hint shows. */
export const useWheelGate = (
  view: HTMLElement | null,
  inEnvironment: boolean,
): boolean => {
  const [hint, setHint] = useState(false);
  const hintedRef = useRef(false);
  useEffect(() => {
    if (!view || inEnvironment) return;
    const gate = createWheelGate({
      focused: () => view.contains(document.activeElement),
      hinted: () => hintedRef.current,
      markHinted: () => {
        hintedRef.current = true;
      },
      setHint,
      later: browserLater,
    });
    view.addEventListener("wheel", gate.onWheel, { capture: true });
    return () => {
      view.removeEventListener("wheel", gate.onWheel, { capture: true });
      gate.dispose();
    };
  }, [view, inEnvironment]);
  return hint;
};
