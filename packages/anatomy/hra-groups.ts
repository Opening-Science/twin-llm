/**
 * HRA organ-group key → body system.
 *
 * Ported from open-twin-xr `src/scene/anatomy/hraGroups.ts` at commit
 * 7334c0bb0664e1f293f88971788520d64734466c (MIT, Copyright (c) 2026 Martin
 * Etzrodt, OSF Staff and Open Twin XR contributors; see
 * third_party/open-twin-xr/LICENSE). Kept in step with that file rather than
 * reinvented, so the two viewers classify the same meshes the same way.
 *
 * HRA writes an organ-group key on every mesh (`#VHFLiver`, `#VHMHeartV1.1`).
 * Its UBERON terms are finer than a body system, so the group key is the handle
 * that works; the term is only a fallback for the `-` placeholder.
 *
 * Upstream note kept as is: the group table puts kidney, ureter and bladder
 * under endocrine, while the term table puts renal calyces under metabolic.
 */
import { type SystemId } from "./systems";

/** `#VHMHeartV1.1` → `heart`, `#VHFLeftKidneyV1.1` → `kidney`. */
export const normaliseGroup = (raw: string): string =>
  raw
    .replace(/^#+/, "")
    .replace(/^VH[FM]/i, "")
    .replace(/V\d+(\.\d+)*$/i, "")
    .replace(/(Left|Right)/gi, "")
    .toLowerCase();

const GROUP_SYSTEM: Readonly<Record<string, SystemId>> = {
  allenbrain: "nervous",
  brain: "nervous",
  spinalcord: "nervous",
  nerveseye: "nervous",
  eye: "nervous",
  muscleseye: "nervous",

  heart: "cardiovascular",
  bloodvasculature: "cardiovascular",

  lung: "respiratory",
  trachea: "respiratory",
  mainbronchus: "respiratory",
  larynx: "respiratory",
  muscleslarynx: "respiratory",

  vertebrae: "musculoskeletal",
  intervertebraldisk: "musculoskeletal",
  pelvis: "musculoskeletal",
  sternum: "musculoskeletal",
  manubrium: "musculoskeletal",
  knee: "musculoskeletal",
  kneeligaments: "musculoskeletal",
  ligamentsknee: "musculoskeletal",
  musclesknee: "musculoskeletal",

  liver: "metabolic",
  liverducts: "metabolic",
  ductsliver: "metabolic",
  gallbladder: "metabolic",
  gallbladderducts: "metabolic",
  ductsgallbladder: "metabolic",
  pancreas: "metabolic",
  pancreasducts: "metabolic",
  ductspancreas: "metabolic",
  spleen: "metabolic",

  mouth: "digestive",
  largeintestine: "digestive",
  colon: "digestive",
  smallintestine: "digestive",
  omentum: "digestive",
  epiploicappendageoftransversecolon: "digestive",

  thymus: "endocrine",
  kidney: "endocrine",
  renalpelvis: "endocrine",
  ureter: "endocrine",
  urinarybladder: "endocrine",

  uterus: "reproductive",
  vagina: "reproductive",
  ovary: "reproductive",
  fallopiantube: "reproductive",
  ligamentsuterusovaries: "reproductive",
  placenta: "reproductive",
  mammarygland: "reproductive",
  prostate: "reproductive",
  testis: "reproductive",

  skin: "integumentary",
  adipose: "integumentary",
  // lymphnode and palatinetonsil are deliberately unmapped (no immune system).
};

/** Full-term placenta and the liver's Couinaud segments: not general anatomy here. */
const HIDDEN_GROUPS = new Set(["placenta", "placentafullterm", "liversegment"]);

/** HRA male spells one of them `left_superiomedial_segment`; it is a liver segment too. */
const LIVER_SEGMENT =
  /^VH_[FM]_(left|right)_(antero|postero|infero|supero|superio)(lateral|medial|superior|inferior)_segment\d*$/i;

const TERM_SYSTEM: Readonly<Record<string, SystemId>> = {
  "UBERON:0001227": "metabolic", // minor calyx
  "UBERON:0001226": "metabolic", // major calyx
};

export const isHiddenGroup = (raw: string | null): boolean =>
  !!raw && raw !== "-" && HIDDEN_GROUPS.has(normaliseGroup(raw));

/** The mesh's group key, or a synthetic one for liver segments, else null. */
export const groupKey = (
  userData: Readonly<Record<string, unknown>>,
  nodeName: string,
): string | null => {
  const value = userData.anatomical_structure_of;
  if (typeof value === "string" && value !== "-" && value !== "") return value;
  if (LIVER_SEGMENT.test(nodeName)) return "liversegment";
  return null;
};

/** Side and sub-part markers at the end of HRA node names (`_L`, `_R`, `_a`). */
const NAME_SUFFIX = /^[a-z]$/i;
const SIDE_WORD = /^(left|right)$/i;

/**
 * A group key made from the node's own name, for HRA meshes whose
 * `anatomical_structure_of` is the `-` placeholder (renal calyces, vas
 * deferens, urethra, hyoid). Without one such a mesh had no organ to light
 * or list, so a click on it lit nothing. `VH_F_minor_calyx_R_c` →
 * `MinorCalyx`, which `normaliseGroup` and `groupLabel` read like any HRA
 * key ("minorcalyx", "Minor calyx"). This TwinLLM addition is not in
 * open-twin-xr's hraGroups.ts.
 */
export const nameGroupKey = (nodeName: string): string | null => {
  const words = nodeName
    .replace(/^VH_[FM]_/i, "")
    .split(/[_\s]+/)
    .filter((word) => word.length > 0 && !NAME_SUFFIX.test(word) && !SIDE_WORD.test(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return words.length > 0 ? words.join("") : null;
};

export const systemForGroup = (raw: string | null): SystemId | null =>
  !raw || raw === "-" ? null : (GROUP_SYSTEM[normaliseGroup(raw)] ?? null);

export const systemForTerm = (term: unknown): SystemId | null =>
  typeof term === "string" ? (TERM_SYSTEM[term] ?? null) : null;
