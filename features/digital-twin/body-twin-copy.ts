/** The Body twin viewer's fixed copy and stored panel ids (bodyloop-avatar.tsx re-exports them). */
export const BODY_TWIN_LOADING = "Loading body twin…";
export const BODYLOOP_NO_SCANS = "No scans for this subject.";
export const BODYLOOP_NO_MESH = "No 3D model stored for this scan — Sync again";
export const SCAN_SYNC = "Sync this scan";
export const SCAN_SYNC_AGAIN = "Sync again";
export const SCAN_RESYNC = "Re-sync";
export const SCAN_SET_DEFAULT = "Set as default";
export const SCAN_CLEAR_DEFAULT = "Clear default";
export const SCAN_DEFAULT_TAG = "default";
export const SCAN_DEFAULT_FAILED = "Could not save the default scan.";
export const BODY_VIEW_LOST =
  "The 3D view stopped: the browser lost its graphics context.";
export const BODY_VIEW_RELOAD = "Reload 3D view";
export const DEMO_NEEDS_WEBGL = "Demo body needs WebGL.";
export const SCAN_NEEDS_WEBGL = "Scan mesh needs WebGL.";
export const TOOLBAR_PANEL = "View controls";
export const OVERLAYS_PANEL = "Scan overlays";

/** Stored keys of the viewer's collapsible panels (infrastructure/ui-kit/panel-memory.ts). */
export const PANEL_IDS = {
  toolbar: "twin-toolbar",
  anatomy: "twin-anatomy",
  details: "twin-details",
  overlays: "twin-scan-overlays",
  /** Not a panel: the Heart chambers toggle (#53), kept the same way. */
  heartChambers: "twin-heart-chambers",
} as const;
