"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { type KeyStep, type StepAxis, stepKey } from "./kit-geometry";

/**
 * Focus for an interactive chart: one point at a time, moved by a pointer,
 * a finger or the keys, and named in a readout line above the chart.
 *
 * A mouse or pen moves the focus on hover alone and clears it on leaving.
 * A finger scrubs while it drags; lifting it keeps the last point until a
 * tap elsewhere on the page. The index maths is pure (`stepKey`, and each
 * chart's own `pick`), so this hook only holds the state and the events.
 *
 * With `tap`, a click or a tap pins a mark: hover still previews another,
 * leaving goes back to the pinned one, and clicking the pinned mark again
 * (or Escape) clears it. The arrow keys pin as they step. A mark can name
 * its own index with `data-focus-index`, so a tap lands on exactly the day,
 * block or segment under the finger; `pick` covers the space between.
 */

/** The point under a pointer at (x, y) inside a chart `width` by `height`. */
export type Pick = (x: number, y: number, width: number, height: number) => number | null;

export type ChartFocus = Readonly<{
  index: number | null;
  /** Spread on the frame around the chart's svg. */
  frame: Readonly<{
    ref: RefObject<HTMLDivElement | null>;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
    onClick: (event: MouseEvent<HTMLDivElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  }>;
  readoutId: string;
}>;

export const useChartFocus = ({
  count,
  pick,
  axis = "x",
  defaultFocus,
  tap = false,
  step,
}: Readonly<{
  count: number;
  pick?: Pick;
  axis?: StepAxis;
  defaultFocus?: number;
  tap?: boolean;
  /** A chart's own rule for some keys (a grid's Up and Down); null leaves the key to `stepKey`. */
  step?: (key: string, current: number | null) => KeyStep | null;
}>): ChartFocus => {
  const initial =
    defaultFocus !== undefined && defaultFocus >= 0 && defaultFocus < count
      ? defaultFocus
      : null;
  const [index, setIndex] = useState<number | null>(initial);
  const [pinned, setPinned] = useState<number | null>(tap ? initial : null);
  const ref = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const readoutId = useId();

  // After a touch, the point stays until a tap lands somewhere else.
  useEffect(() => {
    const onDown = (event: globalThis.PointerEvent) => {
      if (!touched.current) return;
      if (
        ref.current &&
        event.target instanceof Node &&
        ref.current.contains(event.target)
      ) {
        return;
      }
      touched.current = false;
      setIndex(null);
      setPinned(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  /** The mark under a pointer: its own `data-focus-index`, else `pick`. */
  const under = (event: MouseEvent<HTMLDivElement>): number | null => {
    const marked =
      event.target instanceof Element ? event.target.closest("[data-focus-index]") : null;
    if (marked && event.currentTarget.contains(marked)) {
      const own = Number(marked.getAttribute("data-focus-index"));
      if (Number.isInteger(own) && own >= 0 && own < count) return own;
    }
    if (!pick) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return pick(event.clientX - box.left, event.clientY - box.top, box.width, box.height);
  };

  const at = (event: PointerEvent<HTMLDivElement>) => {
    const next = under(event);
    // Between marks, a tap chart goes back to its pinned mark.
    if (next !== null) setIndex(next);
    else if (tap) setIndex(pinned);
  };

  return {
    index: index !== null && index < count ? index : null,
    readoutId,
    frame: {
      ref,
      // A finger has no hover: its moves arrive only while it is down.
      onPointerMove: at,
      onPointerDown: (event) => {
        if (event.pointerType !== "touch") return;
        touched.current = true;
        // A tap chart reads the mark under the finger, so it is not captured.
        if (!tap) event.currentTarget.setPointerCapture(event.pointerId);
        at(event);
      },
      onPointerLeave: (event) => {
        if (event.pointerType !== "touch") setIndex(tap ? pinned : null);
      },
      onClick: (event) => {
        if (!tap) return;
        const hit = under(event);
        if (hit === null) return;
        const next = hit === pinned ? null : hit;
        setPinned(next);
        setIndex(next);
      },
      onKeyDown: (event) => {
        const move = step?.(event.key, index) ?? stepKey(event.key, index, count, axis);
        if (move.kind === "ignore") return;
        event.preventDefault();
        const next = move.kind === "move" ? move.index : null;
        setIndex(next);
        if (tap) setPinned(next);
      },
    },
  };
};

/**
 * The line above an interactive chart that says what is focused. It keeps
 * its height when empty, so focusing never moves the layout, and it is a
 * polite live region, so a screen reader hears each step.
 */
export const ChartReadout = ({
  id,
  text,
}: Readonly<{ id: string; text: string | null | undefined }>) => (
  <p
    id={id}
    aria-live="polite"
    className="text-foreground text-axis min-h-4 font-mono tabular-nums"
  >
    {text || " "}
  </p>
);

/**
 * The one tab stop around an interactive chart: a named group the arrow
 * keys work in. `touch-action: pan-y` lets a page scroll past it while a
 * sideways drag scrubs.
 */
export const ChartFocusFrame = ({
  focus,
  label,
  children,
}: Readonly<{ focus: ChartFocus; label: string; children: ReactNode }>) => (
  <div
    {...focus.frame}
    role="group"
    tabIndex={0}
    aria-label={label}
    aria-describedby={focus.readoutId}
    className="focus-visible:outline-ring touch-pan-y rounded-lg outline-offset-4 focus-visible:outline-2"
  >
    {children}
  </div>
);

/**
 * A dimmed mark: the focused one stays full, the rest step back. Marks
 * only: text never fades, since 40% would fall below AA. Text steps back
 * to the muted colour instead (`mutedUnlessFocused`).
 */
export const dimmed = (focused: number | null, index: number): number | undefined =>
  focused === null || focused === index ? undefined : 0.4;

/** Whether a label should take the muted colour: another point is focused. */
export const mutedUnlessFocused = (focused: number | null, index: number): boolean =>
  focused !== null && focused !== index;
