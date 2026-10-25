import { normaliseGroup } from "./hra-groups";
import { partShown, type AtlasLayerId } from "./layers";
import { type OrganSystem, type SystemId } from "./systems";

/**
 * What the Body twin lights up. Group ids are HRA organ-group keys after
 * `normaliseGroup` (`liver`, `smallintestine`); only HRA meshes carry them.
 * BodyParts3D is one mesh per system, so a system is the most it can light.
 */
export type Highlight = Readonly<
  | { kind: "groups"; ids: readonly string[] }
  | { kind: "system"; ids: readonly SystemId[] }
>;

/** An HRA organ group present in a loaded atlas: its normalised key and a reader's name. */
export type AtlasGroup = Readonly<{ key: string; label: string }>;

/** The part fields the resolver reads; `AtlasPart` has them. */
export type HighlightablePart = Readonly<{ group: string | null; system: OrganSystem }>;

/** A part without its mesh: enough to resolve a highlight and check its toggles. */
export type PartView = HighlightablePart & Readonly<{ layer: AtlasLayerId }>;

/** The parts a highlight lights: a group match, or every layer of a system. */
export const partsFor = <P extends HighlightablePart>(
  target: Highlight,
  parts: readonly P[],
): readonly P[] => {
  if (target.kind === "system") {
    const systems: readonly OrganSystem[] = target.ids;
    return parts.filter((part) => systems.includes(part.system));
  }
  const groups = new Set(target.ids.map(normaliseGroup));
  return parts.filter((part) => part.group !== null && groups.has(part.group));
};

/** True when the highlight lights some part and a toggle hides every one of them. */
export const litPartsHidden = (
  highlight: Highlight | null,
  parts: readonly PartView[],
  layers: Readonly<Record<AtlasLayerId, boolean>>,
  hiddenSystems: readonly OrganSystem[],
): boolean => {
  const lit = highlight ? partsFor(highlight, parts) : [];
  return lit.length > 0 && lit.every((part) => !partShown(part, layers, hiddenSystems));
};

/** HRA writes some groups tissue first in one atlas only (`#VHMDuctsLiver`, `#VHFLiverDucts`). */
const TISSUE_FIRST = new Set(["ducts", "ligaments", "muscles", "nerves"]);

/**
 * A reader's name for an HRA group key, from the key itself rather than a hand
 * table: `#VHFSmallIntestine` → "Small intestine", `#VHMHeartV1.1` → "Heart".
 * A two-word name that starts with the tissue reads organ first, so both
 * atlases say "Liver ducts".
 */
export const groupLabel = (raw: string): string => {
  const words = raw
    .replace(/^#+/, "")
    .replace(/^VH[FM]/i, "")
    .replace(/V\d+(\.\d+)*$/i, "")
    .split(/(?=[A-Z])/)
    .map((word) => word.toLowerCase())
    // Whole words only, so "Cleft palate" keeps its letters.
    .filter((word) => word.length > 0 && word !== "left" && word !== "right");
  const ordered =
    words.length === 2 && TISSUE_FIRST.has(words[0]!) ? [words[1]!, words[0]!] : words;
  const text = ordered.join(" ");
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : raw;
};
