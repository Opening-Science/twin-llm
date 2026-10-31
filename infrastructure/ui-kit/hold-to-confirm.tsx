"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "@/infrastructure/ui";

import { buttonClassName, type ButtonStyle } from "./button";
import {
  holdCountdown,
  holdHint,
  type HoldEvent,
  holdReducer,
  holdSecondsLeft,
} from "./hold-model";
import { createHoldTimer, type HoldTimer } from "./hold-timer";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A button that has to be held, for actions that cannot be undone (erasing
 * personal data). It fills left to right at a constant speed while held by a
 * pointer, or by Space or Enter; letting go early empties it quickly, and
 * drifting off the button cancels. When the fill completes, `onConfirm` runs
 * once and the label becomes `doneLabel`.
 *
 * The fill is a Web Animation; under reduced motion nothing moves and the
 * label counts the seconds down instead. A screen-reader hint says how long
 * to hold, and a live region says when it is done. The timing lives in
 * `hold-timer.ts`, where it is tested.
 */

export type HoldToConfirmProps = Readonly<{
  label: string;
  icon?: ReactNode;
  doneLabel?: string;
  holdMs?: number;
  onConfirm: () => void;
  disabled?: boolean;
}> &
  ButtonStyle;

const HOLD_KEYS: ReadonlySet<string> = new Set([" ", "Enter"]);

export const HoldToConfirm = ({
  label,
  icon,
  doneLabel = "Done",
  holdMs = 1500,
  onConfirm,
  disabled,
  variant,
  size,
  className,
}: HoldToConfirmProps) => {
  const [phase, setPhase] = useState(holdReducer("idle", "reset"));
  const [secondsLeft, setSecondsLeft] = useState(holdSecondsLeft(holdMs, 0));
  const fill = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const confirm = useRef(onConfirm);
  const hintId = useId();
  const reduced = useReducedMotion();

  const send = (event: HoldEvent) => setPhase((was) => holdReducer(was, event));

  // Made on the first press, outside render; one per mounted button.
  const timer = useRef<HoldTimer | null>(null);
  const holdTimer = (): HoldTimer => {
    timer.current ??= createHoldTimer(holdMs, () => {
      send("complete");
      confirm.current();
    });
    return timer.current;
  };

  useEffect(() => {
    confirm.current = onConfirm;
  }, [onConfirm]);
  useEffect(() => () => void timer.current?.letGo(), []);

  // Under reduced motion the label counts down; a quick tick keeps it on time.
  useEffect(() => {
    if (!reduced || phase !== "holding") return;
    const tick = setInterval(() => {
      const since = timer.current?.startedAt() ?? null;
      setSecondsLeft(holdSecondsLeft(holdMs, since === null ? 0 : Date.now() - since));
    }, 100);
    return () => clearInterval(tick);
  }, [reduced, phase, holdMs]);

  const press = () => {
    if (disabled || phase !== "idle" || !holdTimer().press()) return;
    animation.current?.cancel();
    animation.current = reduced
      ? null
      : (fill.current?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
          duration: holdMs,
          easing: "linear",
          fill: "forwards",
        }) ?? null);
    setSecondsLeft(holdSecondsLeft(holdMs, 0));
    send("press");
  };

  const letGo = (event: "release" | "leave") => {
    if (!timer.current?.letGo()) return;
    const current = animation.current;
    animation.current = null;
    const progress = Number(current?.effect?.getComputedTiming().progress ?? 0);
    current?.cancel();
    // Empties quickly from wherever it got to.
    if (current !== null) {
      fill.current?.animate(
        [{ transform: `scaleX(${progress})` }, { transform: "scaleX(0)" }],
        { duration: 150, easing: "ease-out" },
      );
    }
    send(event);
  };

  /** Space or Enter held stands in for a held pointer. */
  const holdKey = (event: KeyboardEvent<HTMLButtonElement>): boolean => {
    if (!HOLD_KEYS.has(event.key)) return false;
    event.preventDefault();
    return true;
  };

  const done = phase === "done";
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={done || undefined}
        aria-describedby={hintId}
        data-phase={phase}
        className={cn(buttonClassName({ variant, size }), "hold-confirm", className)}
        onPointerDown={(event) => {
          if (event.button === 0) press();
        }}
        onPointerUp={() => letGo("release")}
        onPointerLeave={() => letGo("leave")}
        onPointerCancel={() => letGo("leave")}
        onContextMenu={(event) => {
          if (phase === "holding") event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (holdKey(event) && !event.repeat) press();
        }}
        onKeyUp={(event) => {
          if (holdKey(event)) letGo("release");
        }}
        onBlur={() => letGo("release")}
      >
        <span ref={fill} aria-hidden="true" className="hold-confirm-fill" />
        <span className="hold-confirm-label">
          {done ? (
            doneLabel
          ) : phase === "holding" && reduced ? (
            holdCountdown(secondsLeft)
          ) : (
            <>
              {icon}
              {label}
            </>
          )}
        </span>
      </button>
      <span id={hintId} className="sr-only">
        {holdHint(holdMs)}
      </span>
      <span role="status" className="sr-only">
        {done ? doneLabel : ""}
      </span>
    </>
  );
};
