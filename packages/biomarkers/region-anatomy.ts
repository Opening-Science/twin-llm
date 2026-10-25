/**
 * Anchor region → what the twin can light up. TwinLLM-authored and visual only:
 * it never decides a marker's system, which always comes from Anchor's
 * `system_id` (open-twin D12/D14). docs/biomarkers.md has the same table with
 * the reasons.
 *
 * A target has two parts because the atlases differ:
 * - `hraGroups`: HRA organ-group keys (after `normaliseGroup`) from
 *   packages/anatomy/hra-groups.ts. HRA meshes carry them, so single organs light.
 * - `bodyParts3dSystem`: BodyParts3D is merged into one mesh per system, so the
 *   most it can show is the whole system those organs belong to in the atlas's
 *   own classification. This is not the marker's Anchor system: Anchor files
 *   liver under digestive, the atlas under metabolic.
 *
 * `null` means the region has no place on the body: it lights nothing, and the
 * marker gets "No single body location" unless another of its regions maps.
 * Nothing is rerouted to a neighbour (pituitary is not `brain`, adrenal is not
 * `kidney`).
 *
 * Gland rows (thyroid, parathyroid, pituitary, adrenal): neither HRA atlas has
 * these glands, so HRA lights nothing; on BodyParts3D the whole endocrine system
 * is shown, with a note saying so.
 */
import { type SystemId } from "@/packages/anatomy/systems";

import { type AnchorRegionId, type Biomarker } from "./anchor-layer";
import { UNRENDERABLE_IDS } from "./unrenderable";

export type RegionTarget = Readonly<{
  hraGroups: readonly string[];
  bodyParts3dSystem?: SystemId;
}>;

export type RegionAnatomy = Readonly<{
  target: RegionTarget | null;
  /** Shown next to the marker when set. */
  note?: string;
}>;

export const NO_SINGLE_LOCATION = "No single body location";
export const GLAND_NOT_MODELLED = "Gland not modelled; whole system shown";
export const MUSCLE_NOT_MODELLED = "Muscles not modelled one by one; whole system shown";

const gland: RegionAnatomy = {
  target: { hraGroups: [], bodyParts3dSystem: "endocrine" },
  note: GLAND_NOT_MODELLED,
};

export const REGION_ANATOMY: Readonly<Record<AnchorRegionId, RegionAnatomy>> = {
  // In both HRA atlases.
  liver: {
    target: {
      hraGroups: ["liver", "liverducts", "ductsliver"],
      bodyParts3dSystem: "metabolic",
    },
  },
  biliary: {
    target: {
      hraGroups: ["gallbladder", "gallbladderducts", "ductsgallbladder"],
      bodyParts3dSystem: "metabolic",
    },
  },
  // Calprotectin is measured in stool; the intestine is the place it speaks to.
  gut: {
    target: {
      hraGroups: ["smallintestine", "largeintestine", "colon"],
      bodyParts3dSystem: "digestive",
    },
  },
  vasculature: {
    target: { hraGroups: ["bloodvasculature"], bodyParts3dSystem: "cardiovascular" },
  },
  // The upstream HRA group table files kidney under endocrine (see hra-groups.ts).
  kidney: {
    target: { hraGroups: ["kidney", "renalpelvis"], bodyParts3dSystem: "endocrine" },
  },
  // Ovary is in HRA female. The `testis` key exists, but HRA male ships no
  // testis mesh, so nothing lights there.
  gonads: {
    target: { hraGroups: ["ovary", "testis"], bodyParts3dSystem: "reproductive" },
  },
  // HRA male only.
  prostate: {
    target: { hraGroups: ["prostate"], bodyParts3dSystem: "reproductive" },
  },
  // The only bone groups HRA has; there are no long bones.
  bone: {
    target: {
      hraGroups: ["vertebrae", "pelvis", "sternum", "manubrium", "knee"],
      bodyParts3dSystem: "musculoskeletal",
    },
  },
  // HRA has only knee, eye and larynx muscles; lighting the knee for CK would
  // point at the wrong place.
  skeletal_muscle: {
    target: { hraGroups: [], bodyParts3dSystem: "musculoskeletal" },
    note: MUSCLE_NOT_MODELLED,
  },
  thyroid: gland,
  parathyroid: gland,
  pituitary: gland,
  adrenal: gland,
  // Carried in blood. These markers also list vasculature and liver, which light.
  lipid_transport: { target: null },
  // Whole-body states, not places.
  micronutrient_status: { target: null },
  electrolyte_balance: { target: null },
  // Not pinned to the pancreas; Anchor marks this region an override to confirm.
  metabolic_glycemic: { target: null },
  // hsCRP, D12 unrenderable.
  systemic_inflammation: { target: null },
  // `lymphnode` is deliberately unmapped in hra-groups.ts; immune is not a SystemId.
  immune: { target: null },
  // Marrow is not modelled; the blood count is D12 unrenderable.
  bone_marrow_blood: { target: null },
};

export type MarkerAnatomy = Readonly<{
  targets: readonly RegionTarget[];
  note?: string;
}>;

/** What a marker lights up: its mapped regions, unless D12 says it has no place. */
export const markerAnatomy = (marker: Biomarker): MarkerAnatomy => {
  if (UNRENDERABLE_IDS.has(marker.id)) return { targets: [], note: NO_SINGLE_LOCATION };
  const mapped = marker.regionIds.map((region) => REGION_ANATOMY[region]);
  const targets = mapped.flatMap((row) => (row.target ? [row.target] : []));
  if (targets.length === 0) return { targets: [], note: NO_SINGLE_LOCATION };
  const note = mapped.find((row) => row.target && row.note)?.note;
  return note ? { targets, note } : { targets };
};
