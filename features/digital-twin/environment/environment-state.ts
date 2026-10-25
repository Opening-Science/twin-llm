import { type EnvironmentPreset } from "./environment-look";

/**
 * Entering the environment shows it at once as a fixed overlay over the
 * window, then asks for real full screen on the same container and switches
 * to it only if the browser grants it. A browser may leave that request
 * pending behind a permission prompt; the overlay means the button still does
 * something. Where there is no element full screen (iPhone Safari) the overlay
 * simply stays. Both look the same; only Escape differs (the browser owns it
 * in real full screen).
 *
 * The document and the element are passed in, so the fallback is testable
 * without a browser.
 */
export type EnvironmentMode = "off" | "fullscreen" | "overlay";

export type FullscreenDocument = Readonly<{
  fullscreenEnabled: boolean;
  fullscreenElement: object | null;
  exitFullscreen: () => Promise<void>;
}>;

export type FullscreenTarget = Readonly<{
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
}>;

export const openEnvironment = async (
  doc: FullscreenDocument,
  target: FullscreenTarget,
): Promise<Exclude<EnvironmentMode, "off">> => {
  if (!doc.fullscreenEnabled || typeof target.requestFullscreen !== "function") {
    return "overlay";
  }
  try {
    await target.requestFullscreen({ navigationUI: "hide" });
    return "fullscreen";
  } catch {
    return "overlay";
  }
};

/**
 * Leaves real full screen only when our container holds it; another element
 * (a video, another viewer) is not ours to close. An overlay needs nothing.
 */
export const closeEnvironment = async (
  doc: FullscreenDocument,
  mode: EnvironmentMode,
  container: object | null,
): Promise<void> => {
  if (mode !== "fullscreen" || container === null) return;
  if (doc.fullscreenElement !== container) return;
  await doc.exitFullscreen().catch(() => undefined);
};

/** What became of a full-screen request made on entry. */
export type EnterOutcome = "fullscreen" | "overlay" | "dropped";

/**
 * Asks for full screen for an environment that is already showing as an
 * overlay. The grant can arrive after the person has left again (`isCurrent`
 * is then false); full screen is left at once instead of reopening.
 */
export const enterFullscreen = async (
  doc: FullscreenDocument,
  target: FullscreenTarget,
  isCurrent: () => boolean,
): Promise<EnterOutcome> => {
  const mode = await openEnvironment(doc, target);
  if (mode !== "fullscreen") return "overlay";
  if (isCurrent()) return "fullscreen";
  await closeEnvironment(doc, "fullscreen", target);
  return "dropped";
};

/** The parts of a key event Escape handling reads. */
export type EscapeEvent = Readonly<{
  key: string;
  defaultPrevented: boolean;
  /** The target's tag name in upper case, or "" when it is not an element. */
  targetTag: string;
}>;

const TEXT_FIELDS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA"]);

/**
 * Escape closes the overlay, except where something else already used it or
 * it belongs to a text field (the panel search clears itself on Escape).
 */
export const escapeExits = (event: EscapeEvent): boolean =>
  event.key === "Escape" && !event.defaultPrevented && !TEXT_FIELDS.has(event.targetTag);

/**
 * Tab inside the environment cycles through its own controls, since the page
 * behind it is covered. Returns the index to focus when Tab would leave the
 * ends, or null to let the browser move focus normally.
 */
export const wrapFocus = (
  index: number,
  count: number,
  backwards: boolean,
): number | null => {
  if (count === 0) return null;
  if (backwards) return index <= 0 ? count - 1 : null;
  return index === -1 || index >= count - 1 ? 0 : null;
};

export type EnvironmentPanel = "scene" | "anatomy" | "details";

/**
 * How much room the panels get. On a phone an open panel docks at the bottom
 * and only one is open at a time; a laptop opens the scene panel on entry; a
 * wide screen opens all three. Collapsed, each is a small button, so the
 * body's centre stays clear either way.
 */
export type PanelLayout = "phone" | "laptop" | "wide";

export const panelLayout = (width: number): PanelLayout =>
  width < 640 ? "phone" : width < 1024 ? "laptop" : "wide";

const OPEN_ON_ENTRY: Readonly<
  Record<PanelLayout, Readonly<Record<EnvironmentPanel, boolean>>>
> = {
  phone: { scene: false, anatomy: false, details: false },
  laptop: { scene: true, anatomy: false, details: false },
  wide: { scene: true, anatomy: true, details: true },
};

export type EnvironmentState = Readonly<{
  mode: EnvironmentMode;
  preset: EnvironmentPreset;
  followTime: boolean;
  open: Readonly<Record<EnvironmentPanel, boolean>>;
}>;

export type EnvironmentAction =
  | Readonly<{ type: "enter"; layout: PanelLayout }>
  | Readonly<{ type: "fullscreen" }>
  | Readonly<{ type: "exit" }>
  | Readonly<{ type: "preset"; preset: EnvironmentPreset }>
  | Readonly<{ type: "followTime" }>
  // `single`: on a phone, opening one panel closes the others.
  | Readonly<{ type: "toggle"; panel: EnvironmentPanel; single: boolean }>
  | Readonly<{ type: "open"; panel: EnvironmentPanel; single: boolean }>;

export const initialEnvironment: EnvironmentState = {
  mode: "off",
  preset: "studio",
  followTime: true,
  open: OPEN_ON_ENTRY.phone,
};

const opening = (
  open: EnvironmentState["open"],
  panel: EnvironmentPanel,
  single: boolean,
): EnvironmentState["open"] =>
  single ? { ...OPEN_ON_ENTRY.phone, [panel]: true } : { ...open, [panel]: true };

export const environmentReducer = (
  state: EnvironmentState,
  action: EnvironmentAction,
): EnvironmentState => {
  switch (action.type) {
    case "enter":
      return { ...state, mode: "overlay", open: OPEN_ON_ENTRY[action.layout] };
    case "fullscreen":
      // Granted late: only an environment that is still open moves into it.
      return state.mode === "overlay" ? { ...state, mode: "fullscreen" } : state;
    case "exit":
      return state.mode === "off" ? state : { ...state, mode: "off" };
    case "preset":
      return { ...state, preset: action.preset };
    case "followTime":
      return { ...state, followTime: !state.followTime };
    case "open":
      // A biomarker chosen on the card opens Details, so its row and notes show.
      return state.open[action.panel]
        ? state
        : { ...state, open: opening(state.open, action.panel, action.single) };
    case "toggle":
      return {
        ...state,
        open: state.open[action.panel]
          ? { ...state.open, [action.panel]: false }
          : opening(state.open, action.panel, action.single),
      };
  }
};
