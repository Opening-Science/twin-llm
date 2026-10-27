/**
 * The sidebar's two states on wide screens, as in a chat app: pinned (a
 * column beside the page) or tucked away. Tucked away, pointing at the
 * sidebar button or the left edge shows it over the page ("peek"), and moving
 * the pointer off it hides it again. A click on the button pins it; a click
 * on the button in a pinned sidebar tucks it away. Pure, so the rules are
 * tested without a browser; `shell-frame.tsx` feeds it pointer and key events.
 *
 * The pinned choice is a cookie, not localStorage, so the server renders the
 * right layout and the page does not jump on load.
 */

export type SidebarState = Readonly<{ pinned: boolean; peeking: boolean }>;

export type SidebarEvent =
  | "point" // the pointer reached the button, the left edge or the peeking panel
  | "leave" // the pointer stayed off all three for the grace period
  | "toggle" // a click on the sidebar button, or the keyboard shortcut
  | "escape"
  | "navigate"; // a link in the peeking panel was followed

export const sidebarReducer = (
  state: SidebarState,
  event: SidebarEvent,
): SidebarState => {
  switch (event) {
    case "point":
      return state.pinned || state.peeking ? state : { ...state, peeking: true };
    case "leave":
    case "escape":
    case "navigate":
      return state.peeking ? { ...state, peeking: false } : state;
    case "toggle":
      return { pinned: !state.pinned, peeking: false };
  }
};

/** How long the pointer may be off the sidebar before a peek closes. */
export const PEEK_GRACE_MS = 250;

/** The peeking panel is 16rem wide plus its 0.5rem inset; past this, the pointer has left it. */
export const PEEK_REACH_PX = 16 * 16 + 8 + 24;

export const SIDEBAR_COOKIE = "twinllm-sidebar";

export const pinnedFromCookie = (value: string | undefined): boolean =>
  value === "pinned";

/** A year-long, same-site cookie; it holds a layout choice and nothing else. */
export const sidebarCookie = (pinned: boolean): string =>
  `${SIDEBAR_COOKIE}=${pinned ? "pinned" : "tucked"}; Path=/; Max-Age=31536000; SameSite=Lax`;

/** Ctrl+. or ⌘+. pins or tucks the sidebar, as long as no other modifier is held. */
export const isSidebarShortcut = (
  event: Readonly<{
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }>,
): boolean =>
  event.key === "." &&
  (event.ctrlKey || event.metaKey) &&
  !event.altKey &&
  !event.shiftKey;
