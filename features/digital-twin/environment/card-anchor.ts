/**
 * Where the picked part is on screen, shared between the canvas (which
 * projects it every drawn frame) and the card (which sits beside it). A tiny
 * external store, so a moving camera re-renders only the card, never the
 * whole viewer.
 */

export type ScreenAnchor = Readonly<{
  x: number;
  y: number;
  /** The canvas size the point was projected into. */
  width: number;
  height: number;
  /** The point is behind the camera; only the size is meaningful. */
  behind: boolean;
}>;

export type AnchorStore = Readonly<{
  get: () => ScreenAnchor | null;
  set: (next: ScreenAnchor | null) => void;
  subscribe: (listener: () => void) => () => void;
}>;

/** Changes smaller than this are not worth a re-render. */
const SAME_PX = 0.5;

const same = (a: ScreenAnchor | null, b: ScreenAnchor | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.x - b.x) < SAME_PX &&
    Math.abs(a.y - b.y) < SAME_PX &&
    a.width === b.width &&
    a.height === b.height &&
    a.behind === b.behind);

export const createAnchorStore = (): AnchorStore => {
  let current: ScreenAnchor | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      if (same(current, next)) return;
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const CARD_WIDTH_PX = 288;
const GAP_PX = 20;
const EDGE_PX = 12;
/** How far the card's near edge sits from the point, vertically. */
const LEAD_PX = 40;

export type CardPlacement = Readonly<{ left: number; top: number }>;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Beside the point: on the right unless that runs off the canvas, then on the
 * left. In the upper half the card hangs down from the point, in the lower
 * half it rises above it, so a tall card is never cut off at the bottom; it is
 * kept inside the edges with its measured height. With the point behind the
 * camera it sits at the bottom left; before the first frame, at the top left.
 */
export const cardPlacement = (
  anchor: ScreenAnchor | null,
  cardHeight: number,
): CardPlacement => {
  if (!anchor) return { left: EDGE_PX, top: EDGE_PX };
  const lowest = Math.max(EDGE_PX, anchor.height - EDGE_PX - cardHeight);
  if (anchor.behind) return { left: EDGE_PX, top: lowest };
  const right = anchor.x + GAP_PX;
  const left =
    right + CARD_WIDTH_PX <= anchor.width - EDGE_PX
      ? right
      : Math.max(EDGE_PX, anchor.x - GAP_PX - CARD_WIDTH_PX);
  const wanted =
    anchor.y <= anchor.height / 2 ? anchor.y - LEAD_PX : anchor.y + LEAD_PX - cardHeight;
  return { left, top: clamp(wanted, EDGE_PX, lowest) };
};
