import { type Highlight } from "./highlight";
import { systemForGroup } from "./hra-groups";
import { type AtlasScheme } from "./manifest";
import { SYSTEM_IDS, type SystemId, isSystemId } from "./systems";

/**
 * What a `twin.body` view and the chat's UI context may focus the twin on: one
 * of the nine body systems, or one of a short list of organs. The organs are
 * HRA organ-group keys (`hra-groups.ts`) that a biomarker or a vital maps to,
 * so every one has a mesh to light on both HRA atlases. The list is closed:
 * the model picks from it, and anything else is refused before a read.
 */

export const TWIN_FOCUS_ORGANS = [
  "heart",
  "lung",
  "brain",
  "liver",
  "kidney",
  "pancreas",
  "bloodvasculature",
] as const;

export type TwinFocusOrgan = (typeof TWIN_FOCUS_ORGANS)[number];

/**
 * The HRA groups the brain lights. On both HRA atlases the `brain` group is
 * the optic chiasm alone; the whole brain is the `allenbrain` group. The
 * chiasm is part of the brain, so both are lit.
 */
export const BRAIN_GROUPS = ["allenbrain", "brain"] as const;

/** The HRA groups each focus organ lights: its own group, except the brain. */
export const ORGAN_GROUPS: Readonly<Record<TwinFocusOrgan, readonly string[]>> = {
  heart: ["heart"],
  lung: ["lung"],
  brain: BRAIN_GROUPS,
  liver: ["liver"],
  kidney: ["kidney"],
  pancreas: ["pancreas"],
  bloodvasculature: ["bloodvasculature"],
};

export const TWIN_FOCUS_IDS = [...SYSTEM_IDS, ...TWIN_FOCUS_ORGANS] as const;

export type TwinFocusId = (typeof TWIN_FOCUS_IDS)[number];

export const isTwinFocusId = (value: unknown): value is TwinFocusId =>
  typeof value === "string" && (TWIN_FOCUS_IDS as readonly string[]).includes(value);

const ORGAN_LABELS: Readonly<Record<TwinFocusOrgan, string>> = {
  heart: "Heart",
  lung: "Lungs",
  brain: "Brain",
  liver: "Liver",
  kidney: "Kidneys",
  pancreas: "Pancreas",
  bloodvasculature: "Blood vessels",
};

const SYSTEM_LABELS: Readonly<Record<SystemId, string>> = {
  musculoskeletal: "Musculoskeletal system",
  cardiovascular: "Cardiovascular system",
  respiratory: "Respiratory system",
  nervous: "Nervous system",
  digestive: "Digestive system",
  metabolic: "Metabolic system",
  endocrine: "Endocrine system",
  reproductive: "Reproductive system",
  integumentary: "Skin",
};

export type TwinFocus = Readonly<{
  id: TwinFocusId;
  kind: "organ" | "system";
  label: string;
  /** The system it belongs to in the HRA group table (an organ) or itself. */
  system: SystemId;
}>;

/** An organ's system as the HRA group table files it; every focus organ has one. */
const organSystem = (organ: TwinFocusOrgan): SystemId =>
  systemForGroup(organ) ?? "metabolic";

export const twinFocus = (id: TwinFocusId): TwinFocus =>
  isSystemId(id)
    ? { id, kind: "system", label: SYSTEM_LABELS[id], system: id }
    : { id, kind: "organ", label: ORGAN_LABELS[id], system: organSystem(id) };

/**
 * What the focus lights on each atlas kind. HRA lights the organ's groups or
 * the whole system; BodyParts3D is one mesh per system, so an organ lights its system.
 */
export const focusHighlights = (
  id: TwinFocusId,
): Readonly<Record<AtlasScheme, Highlight>> => {
  const focus = twinFocus(id);
  const system: Highlight = { kind: "system", ids: [focus.system] };
  return {
    hra: isSystemId(id) ? system : { kind: "groups", ids: [...ORGAN_GROUPS[id]] },
    bodyparts3d: system,
  };
};

/**
 * The focus a click on the twin names: the focus organ whose groups hold the
 * part's HRA group (a click on `allenbrain` names the brain), or else the
 * part's system. Null when neither is known.
 */
export const focusOfPick = (
  group: string | null,
  system: string | null,
): TwinFocusId | null => {
  const organ =
    group === null
      ? undefined
      : TWIN_FOCUS_ORGANS.find((candidate) => ORGAN_GROUPS[candidate].includes(group));
  if (organ !== undefined) return organ;
  return system !== null && isSystemId(system) ? system : null;
};

/**
 * The depth a focused twin starts at, so the focus is in a layer that shows:
 * muscle for the musculoskeletal system, the scan for the skin, organs for the
 * rest (`layers.ts`: 0 scan, 1 muscle, 3 organs).
 */
export const focusDepth = (id: TwinFocusId): number => {
  if (id === "integumentary") return 0;
  return id === "musculoskeletal" ? 1 : 3;
};
