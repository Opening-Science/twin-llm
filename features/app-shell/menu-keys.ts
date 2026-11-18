/**
 * Arrow keys in a small menu: which item a key moves focus to. Pure.
 * `current` is the focused item's index, or -1 when none is. Null means the
 * key is not the menu's, so the browser keeps its own behaviour (Tab still
 * walks the items).
 */
export const menuKeyTarget = (
  key: string,
  current: number,
  count: number,
): number | null => {
  if (count === 0) return null;
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
