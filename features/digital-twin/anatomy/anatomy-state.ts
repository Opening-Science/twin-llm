import {
  DEPTH_MAX,
  DEPTH_MIN,
  snapDepth,
  stepStop,
  type AtlasLayerId,
} from "@/packages/anatomy/layers";
import {
  type AtlasGroup,
  type Highlight,
  type PartView,
} from "@/packages/anatomy/highlight";
import {
  ATLAS_IDS,
  ATLASES,
  DEFAULT_ATLAS_ID,
  type AtlasId,
  type AtlasScheme,
} from "@/packages/anatomy/manifest";
import { type OrganSystem, type SystemId } from "@/packages/anatomy/systems";

/** Where the atlas load stands, as reported by the 3D layer component. */
export type AnatomyLoad =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading"; percent: number | null }>
  | Readonly<{
      kind: "ready";
      presentLayers: readonly AtlasLayerId[];
      systems: readonly OrganSystem[];
      /** Systems with a mesh in any layer, for the highlight picker. */
      partSystems: readonly SystemId[];
      /** HRA organ groups with meshes; empty on BodyParts3D. */
      groups: readonly AtlasGroup[];
      /** The parts without meshes, so the controls can tell a lit part is toggled off. */
      parts: readonly PartView[];
      anchor: "hips" | "bbox";
      fitOk: boolean;
    }>
  | Readonly<{ kind: "error" }>;

export type AnatomyState = Readonly<{
  /** Latches true the first time anyone slides past the scan or opens a layer. */
  requested: boolean;
  targetDepth: number;
  atlasId: AtlasId;
  layers: Readonly<Record<AtlasLayerId, boolean>>;
  hiddenSystems: readonly OrganSystem[];
  /** What glows, if anything. Group keys are atlas-specific, so an atlas switch clears it. */
  highlight: Highlight | null;
  /** The Biomarkers-tab row behind the highlight, if one set it (it may light nothing). */
  highlightFrom: HighlightFrom | null;
  load: AnatomyLoad;
  /** Bumped by "Try again" so the loader effect runs once more. */
  retry: number;
}>;

/** A Biomarkers-tab row, with what it lights on each atlas kind. */
export type HighlightFrom = Readonly<{
  id: string;
  label: string;
  highlights: Readonly<Record<AtlasScheme, Highlight | null>>;
}>;

export type AnatomyAction =
  | Readonly<{ type: "depth"; depth: number }>
  | Readonly<{ type: "release" }>
  | Readonly<{ type: "step"; direction: 1 | -1 }>
  | Readonly<{ type: "atlas"; atlasId: AtlasId }>
  | Readonly<{ type: "installed"; installed: Readonly<Record<AtlasId, boolean>> | null }>
  | Readonly<{ type: "toggleLayer"; layer: AtlasLayerId }>
  | Readonly<{ type: "toggleSystem"; system: OrganSystem }>
  | Readonly<{ type: "highlight"; highlight: Highlight | null; from?: HighlightFrom }>
  | Readonly<{ type: "load"; load: AnatomyLoad }>
  | Readonly<{ type: "retry" }>;

export const initialAnatomyState: AnatomyState = {
  requested: false,
  targetDepth: DEPTH_MIN,
  atlasId: DEFAULT_ATLAS_ID,
  layers: { muscle: true, skeleton: true, organs: true },
  hiddenSystems: [],
  highlight: null,
  highlightFrom: null,
  load: { kind: "idle" },
  retry: 0,
};

/** The atlas to show: the current one if installed, else the first installed one. */
export const preferredAtlas = (
  current: AtlasId,
  installed: Readonly<Record<AtlasId, boolean>> | null,
): AtlasId =>
  installed === null || installed[current]
    ? current
    : (ATLAS_IDS.find((id) => installed[id]) ?? current);

/**
 * A picked highlight names one atlas's group keys, so it is cleared. A row's
 * highlight is lit again on the new atlas, so the row stays selected.
 */
const switchAtlas = (state: AnatomyState, atlasId: AtlasId): AnatomyState => {
  if (atlasId === state.atlasId) return state;
  const from = state.highlightFrom;
  return {
    ...state,
    atlasId,
    hiddenSystems: [],
    highlight: from ? from.highlights[ATLASES[atlasId].scheme] : null,
    load: { kind: "idle" },
  };
};

const withDepth = (state: AnatomyState, depth: number): AnatomyState => {
  const targetDepth = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, depth));
  return { ...state, targetDepth, requested: state.requested || targetDepth > DEPTH_MIN };
};

export const anatomyReducer = (
  state: AnatomyState,
  action: AnatomyAction,
): AnatomyState => {
  switch (action.type) {
    case "depth":
      return withDepth(state, action.depth);
    case "release":
      return withDepth(state, snapDepth(state.targetDepth));
    case "step":
      return withDepth(state, stepStop(state.targetDepth, action.direction));
    case "atlas":
      return switchAtlas(state, action.atlasId);
    case "installed":
      // Only moves off the current atlas when it is missing, so a choice made
      // before the status arrived is kept.
      return switchAtlas(state, preferredAtlas(state.atlasId, action.installed));
    case "toggleLayer":
      // A toggle only hides or shows; the atlas loads when someone moves past the scan.
      return {
        ...state,
        layers: { ...state.layers, [action.layer]: !state.layers[action.layer] },
      };
    case "toggleSystem":
      return {
        ...state,
        hiddenSystems: state.hiddenSystems.includes(action.system)
          ? state.hiddenSystems.filter((system) => system !== action.system)
          : [...state.hiddenSystems, action.system],
      };
    case "highlight":
      return {
        ...state,
        highlight: action.highlight,
        highlightFrom: action.from ?? null,
      };
    case "load":
      return { ...state, load: action.load };
    case "retry":
      return { ...state, load: { kind: "idle" }, retry: state.retry + 1 };
  }
};
