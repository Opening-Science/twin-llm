/**
 * The sidebar on wide screens, as two flags: pinned (a column beside the
 * page) and peeking (a tucked sidebar shown over the page while the pointer
 * is near). Pure; the frame turns pointer and key events into these events.
 * An event that changes nothing returns the same state object, so React does
 * not re-render for it.
 */

export type SidebarState = Readonly<{ pinned: boolean; peeking: boolean }>;

export type SidebarEvent =
  /** The pointer reached the floating button, the edge strip or the panel. */
  | "reach"
  /** The pointer stayed away for the grace period. */
  | "leave"
  /** The button, the pin button or the shortcut. */
  | "toggle"
  | "escape"
  /** A link inside the peeking panel was followed. */
  | "follow";

export const sidebarReducer = (
  state: SidebarState,
  event: SidebarEvent,
): SidebarState => {
  switch (event) {
    case "reach":
      return state.pinned || state.peeking ? state : { pinned: false, peeking: true };
    case "toggle":
      return { pinned: !state.pinned, peeking: false };
    case "leave":
    case "escape":
    case "follow":
      return state.peeking ? { ...state, peeking: false } : state;
  }
};

/** How long the pointer may be away before a peeking sidebar goes. */
export const PEEK_GRACE_MS = 250;

/** Further than this from the left edge counts as away, even without a leave event. */
export const PEEK_REACH_PX = 288;

/** Kept so choices made before this cookie's reader was rewritten still hold. */
export const SIDEBAR_COOKIE = "twinllm-sidebar";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Only the exact value `pinned` pins; anything else, or nothing, is tucked. */
export const pinnedFromCookie = (value: string | undefined): boolean =>
  value === "pinned";

/** The cookie as `document.cookie` takes it. */
export const sidebarCookie = (pinned: boolean): string =>
  `${SIDEBAR_COOKIE}=${pinned ? "pinned" : "tucked"}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
