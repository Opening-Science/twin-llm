/**
 * Arrow keys in the thread actions menu (#378), as a plain function: which
 * item takes focus next. Up and Down wrap, Home and End jump to the ends.
 * Any other key, or an empty menu, gives null and the browser keeps its own
 * behaviour (Tab still moves through the items in order).
 */
export const menuFocusIndex = (
  current: number,
  count: number,
  key: string,
): number | null => {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
};
