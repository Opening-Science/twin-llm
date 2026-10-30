"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { formatNumber } from "@/infrastructure/format-measure";
import { cn } from "@/infrastructure/ui";

import { buttonClassName, type ButtonStyle } from "./button";
import {
  type Countdown,
  pausedBy,
  pauseCountdown,
  remainingAt,
  resumeCountdown,
  startCountdown,
} from "./countdown";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A destructive action with a grace period instead of a dialog.
 *
 * Pressing it runs `onAct` (the soft step: hide the item, mark it deleted)
 * and the button becomes "Undo", with a thin line burning along its bottom
 * for `undoWindow` ms. Undo, or Escape, calls `onUndo`. When the line runs
 * out, `onExpire` does the real thing. The time stands still while the tab
 * is hidden, and while a mouse rests on the button after leaving it once (it
 * is always on the button at the moment of the press, which must not count).
 *
 * The countdown is plain values (`countdown.ts`) driven by one timer; the
 * line is a Web Animation paused and played in step with it. Focus stays on
 * (moves to) the button while armed, and a polite live region says how long
 * Undo is available.
 */

export type UndoButtonProps = Readonly<{
  label: string;
  icon?: ReactNode;
  /** What happened, for the live region: "Thread deleted." */
  actedText: string;
  undoLabel?: string;
  undoWindow?: number;
  onAct: () => void;
  onUndo: () => void;
  onExpire: () => void;
  disabled?: boolean;
}> &
  ButtonStyle;

type Controls = Readonly<{ enter: () => void; leave: () => void }>;

export const UndoButton = ({
  label,
  icon,
  actedText,
  undoLabel = "Undo",
  undoWindow = 5000,
  onAct,
  onUndo,
  onExpire,
  disabled,
  variant,
  size,
  className,
}: UndoButtonProps) => {
  const [armed, setArmed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const controls = useRef<Controls | null>(null);
  const expire = useRef(onExpire);
  const reduced = useReducedMotion();

  useEffect(() => {
    expire.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!armed) return;
    // Mutable on purpose: one armed window's clock, private to this effect.
    const clock: { countdown: Countdown; timer?: ReturnType<typeof setTimeout> } = {
      countdown: startCountdown(undoWindow, performance.now()),
    };
    const hover = { on: false, left: false };
    const animation =
      line.current?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        duration: undoWindow,
        // Reduced motion: the line drops once a second instead of sliding.
        easing: reduced
          ? `steps(${Math.max(1, Math.ceil(undoWindow / 1000))}, end)`
          : "linear",
        fill: "forwards",
      }) ?? null;
    const update = () => {
      const now = performance.now();
      clearTimeout(clock.timer);
      if (pausedBy({ hovered: hover.on, hidden: document.hidden })) {
        clock.countdown = pauseCountdown(clock.countdown, now);
        animation?.pause();
        return;
      }
      clock.countdown = resumeCountdown(clock.countdown, now);
      animation?.play();
      clock.timer = setTimeout(
        () => {
          setArmed(false);
          expire.current();
        },
        remainingAt(clock.countdown, now),
      );
    };
    controls.current = {
      enter: () => {
        if (!hover.left) return;
        hover.on = true;
        update();
      },
      leave: () => {
        hover.left = true;
        hover.on = false;
        update();
      },
    };
    document.addEventListener("visibilitychange", update);
    update();
    button.current?.focus();
    return () => {
      clearTimeout(clock.timer);
      animation?.cancel();
      document.removeEventListener("visibilitychange", update);
      controls.current = null;
    };
  }, [armed, undoWindow, reduced]);

  const undo = () => {
    setArmed(false);
    onUndo();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        data-armed={armed ? "" : undefined}
        className={cn(buttonClassName({ variant, size }), "undo-button", className)}
        onClick={() => {
          if (armed) return undo();
          onAct();
          setArmed(true);
        }}
        onKeyDown={(event) => {
          if (armed && event.key === "Escape") {
            event.preventDefault();
            undo();
          }
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") controls.current?.enter();
        }}
        onPointerLeave={() => controls.current?.leave()}
      >
        {armed ? (
          undoLabel
        ) : (
          <>
            {icon}
            {label}
          </>
        )}
        <span
          ref={line}
          hidden={!armed}
          aria-hidden="true"
          className="undo-button-line"
        />
      </button>
      <span role="status" className="sr-only">
        {armed
          ? `${actedText} ${undoLabel} is available for ${formatNumber(undoWindow / 1000, 0)} seconds, or press Escape.`
          : ""}
      </span>
    </>
  );
};
