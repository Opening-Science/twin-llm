import { type AtlasId } from "@/packages/anatomy/manifest";
import { depthPosition, type LayerId } from "@/packages/anatomy/layers";
import { type OrganSystem } from "@/packages/anatomy/systems";

import { DEMO_FIT_NOTE, DEMO_FIT_NOTE_UNPOSED, DEMO_TYPICAL_NOTE } from "./demo-copy";

/**
 * Every user-facing string for the anatomy layers, in one place so lint:claims
 * checks them. The fit is simple and the copy says exactly how simple.
 */
/** API response, read by developers, so it may name the install command. */
export const ANATOMY_NOT_INSTALLED_API =
  "Anatomy atlas not installed. Run bun run anatomy:fetch.";

/** The install step is in docs/anatomy.md; the page itself never names a command. */
export const ANATOMY_NOT_INSTALLED = "Reference anatomy is not available here.";
export const ANATOMY_LOAD_ERROR = "Could not load the reference anatomy.";
export const ANATOMY_RETRY = "Try again";
export const ANATOMY_FIT_FAILED = "Reference anatomy could not be fitted to this scan.";
export const ANATOMY_TYPICAL_NOTE =
  "Body shape is measured. Organ positions and limb pose are typical, not measured.";
export const ANATOMY_DONOR_NOTE =
  "The atlas follows the body's sex when it is known. A scan's sex is not, so choose its atlas here.";
/** The atlas donor and the body differ; the viewer never shows that silently. */
export const MALE_ATLAS_ON_FEMALE =
  "Male reference anatomy shown on a female body. Choose HRA · female donor for female anatomy.";
export const NO_FEMALE_ATLAS =
  "Male reference anatomy shown: the female atlas is not available here.";
export const FEMALE_ATLAS_ON_MALE = "Female reference anatomy shown on a male body.";
export const ANATOMY_CHANGES_NOTE =
  "Merged, simplified and shaded by the Open Science Foundation's open-twin-xr; positioned by TwinLLM.";
export const ANATOMY_NOT_IN_ATLAS = "Not in this atlas.";

/** API response, read by developers, so it may name the variable. */
export const SKELETON_NOT_CONFIGURED_API =
  "No open-anatomy skeleton here. Set ANATOMY_SKELETON_GLB to a skeleton GLB.";

export const SKELETON_HEADING = "Skeleton";
export const skeletonSourceLabel = (caseId: string | null): string =>
  caseId ? `CT skeleton · open-anatomy ${caseId}` : "CT skeleton · open-anatomy";
export const SKELETON_ISOLATE = "Only the skeleton";
export const SKELETON_EXPLODE = "Spread the bones";
export const skeletonExplodeText = (amount: number): string =>
  amount <= 0 ? "Together" : `${Math.round(amount * 100)}% apart`;
export const SKELETON_LOADING = "Loading the CT skeleton…";
export const SKELETON_LOAD_ERROR = "Could not load the CT skeleton.";
export const SKELETON_FIT_FAILED = "The CT skeleton could not be placed in this body.";
/** Says how the bones are placed, and that they are not this body's. */
export const skeletonFitNote = (anchor: "hips" | "bbox"): string =>
  anchor === "hips"
    ? "Bones from one public CT case, shown at their CT size with the hip joints placed at this body's by estimate. Not this body's skeleton."
    : "Bones from one public CT case, shown at their CT size and placed by this body's outline. Not this body's skeleton.";
/** What the build left out, from atlas.json; never drawn and never drawn from another atlas. */
export const skeletonLeftOutNote = (summary: string): string | null =>
  summary.length > 0 ? `Left out of this build: ${summary}.` : null;
export const SKELETON_MODELLED_NOTE =
  "Parts marked modelled were built by open-anatomy, not segmented from the CT.";
export const SKELETON_CREDIT_FALLBACK =
  "Skeleton built by open-anatomy from a public CT case, CC BY 4.0.";

export const HIGHLIGHT_LABEL = "Highlight";
export const HIGHLIGHT_NONE = "None";
export const HIGHLIGHT_SYSTEMS = "Body systems";
export const HIGHLIGHT_GROUPS = "Organs";
/** Shown only when the highlight lights parts and a toggle hides every one of them. */
export const HIGHLIGHT_HIDDEN = "Highlighted parts are hidden by a toggle.";
export const HIGHLIGHT_SYSTEMS_ONLY =
  "This atlas is one mesh per system, so only whole systems can be highlighted.";

export const anatomyLoading = (percent: number | null): string =>
  percent === null
    ? "Loading reference anatomy…"
    : `Loading reference anatomy… ${Math.round(percent)}%`;

/** What the layers sit inside: a BodyLoop scan, or the synthetic demo body. */
export type AnatomyEnvelope = "scan" | "demo";

export const anatomyTypicalNote = (envelope: AnatomyEnvelope = "scan"): string =>
  envelope === "demo" ? DEMO_TYPICAL_NOTE : ANATOMY_TYPICAL_NOTE;

/** `posed`: the demo body stands in the atlas's stance (a rigged body); scans ignore it. */
export const anatomyFitNote = (
  anchor: "hips" | "bbox",
  envelope: AnatomyEnvelope = "scan",
  posed = false,
): string =>
  envelope === "demo"
    ? posed
      ? DEMO_FIT_NOTE
      : DEMO_FIT_NOTE_UNPOSED
    : anchor === "hips"
      ? "Reference anatomy from a donor atlas, scaled to this scan's height and aligned at the hips. Not the scanned person's anatomy."
      : "Reference anatomy from a donor atlas, scaled to this scan's height and centred on the scan outline. Not the scanned person's anatomy.";

export const LAYER_LABEL: Readonly<Record<LayerId, string>> = {
  scan: "Scan",
  muscle: "Muscle",
  skeleton: "Skeleton",
  organs: "Organs",
};

export const SYSTEM_LABEL: Readonly<Record<OrganSystem, string>> = {
  musculoskeletal: "Musculoskeletal",
  cardiovascular: "Cardiovascular",
  respiratory: "Respiratory",
  nervous: "Nervous",
  digestive: "Digestive",
  metabolic: "Metabolic",
  endocrine: "Endocrine",
  reproductive: "Reproductive",
  integumentary: "Integumentary",
  unassigned: "Unassigned",
};

export const ATLAS_OPTION_LABEL: Readonly<Record<AtlasId, string>> = {
  bodyparts3d: "BodyParts3D · male donor · 10 MB",
  "hra-f": "HRA · female donor · 15 MB",
  "hra-m": "HRA · male donor · 8.5 MB",
};

/** Static coverage notes; layers with no meshes also get ANATOMY_NOT_IN_ATLAS at runtime. */
export const ATLAS_COVERAGE_NOTE: Readonly<Record<AtlasId, string | null>> = {
  bodyparts3d: null,
  "hra-f":
    "Almost no muscle in this atlas. Partial skeleton: no skull, ribs, arms or hands.",
  "hra-m":
    "Almost no muscle in this atlas. Partial skeleton: no skull, ribs, arms or hands.",
};

/** The slider's aria-valuetext: "Skeleton" or "Between muscle and skeleton". */
export const depthValueText = (depth: number): string => {
  const position = depthPosition(depth);
  if ("exact" in position) return LAYER_LABEL[position.exact];
  const [lower, upper] = position.between;
  return `Between ${LAYER_LABEL[lower].toLowerCase()} and ${LAYER_LABEL[upper].toLowerCase()}`;
};
