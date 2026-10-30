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
import { holdHint, type HoldEvent, holdReducer } from "./hold-model";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A button that has to be held, for actions that cannot be undone (erasing
 * personal data). It fills left to right at a constant speed while held by a
 * pointer, or by Space or Enter; letting go early empties it quickly, and
 * drifting off the button cancels. When the fill completes, `onConfirm` runs
 * once and the label becomes `doneLabel`.
 *
 * The fill is a Web Animation; under reduced motion it moves in four steps
 * instead of sliding. A screen-reader hint says how long to hold, and a live
 * region says when it is done.
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

type Run = Readonly<{
  timer: ReturnType<typeof setTimeout>;
  animation: Animation | null;
}>;

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
  const fill = useRef<HTMLSpanElement>(null);
  const run = useRef<Run | null>(null);
  const confirm = useRef(onConfirm);
  const hintId = useId();
  const reduced = useReducedMotion();

  useEffect(() => {
    confirm.current = onConfirm;
  }, [onConfirm]);
  useEffect(
    () => () => {
      if (run.current) clearTimeout(run.current.timer);
    },
    [],
  );

  const send = (event: HoldEvent) => setPhase((was) => holdReducer(was, event));

  const press = () => {
    if (disabled || phase !== "idle") return;
    run.current?.animation?.cancel();
    const animation =
      fill.current?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: holdMs,
        easing: reduced ? "steps(4, end)" : "linear",
        fill: "forwards",
      }) ?? null;
    // Letting go clears this timer, and a press only starts from idle, so
    // when it fires the hold is complete and it fires once.
    const timer = setTimeout(() => {
      run.current = null;
      send("complete");
      confirm.current();
    }, holdMs);
    run.current = { timer, animation };
    send("press");
  };

  const letGo = (event: "release" | "leave") => {
    const current = run.current;
    if (phase !== "holding" || current === null) return;
    clearTimeout(current.timer);
    run.current = null;
    const progress = Number(current.animation?.effect?.getComputedTiming().progress ?? 0);
    current.animation?.cancel();
    // Empties quickly from wherever it got to.
    fill.current?.animate(
      [{ transform: `scaleX(${progress})` }, { transform: "scaleX(0)" }],
      { duration: 150, easing: "ease-out" },
    );
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
