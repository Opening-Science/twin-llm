import { type AtlasLayerId } from "./layers";
import { type AtlasScheme } from "./manifest";
import {
  groupKey,
  isHiddenGroup,
  normaliseGroup,
  systemForGroup,
  systemForTerm,
} from "./hra-groups";
import { isSystemId, type OrganSystem } from "./systems";

/**
 * Which UI layer an atlas mesh belongs to. Read from node extras (GLTFLoader
 * copies them to `userData`), never from names: the loader strips `/` from
 * `musculoskeletal/bone`.
 *
 * - `hull`: the atlas's own skin. The scan is the envelope, so it is dropped.
 * - `hidden`: donor-specific or duplicate geometry (placenta, liver segments).
 */
export type AtlasPartClass =
  | Readonly<{ kind: "layer"; layer: AtlasLayerId; system: OrganSystem }>
  | Readonly<{ kind: "hull" }>
  | Readonly<{ kind: "hidden" }>;

type Extras = Readonly<Record<string, unknown>>;

const organ = (system: OrganSystem): AtlasPartClass => ({
  kind: "layer",
  layer: "organs",
  system,
});

/** BodyParts3D: one node per (system, layer) with `extras.system` and `extras.layer`. */
export const classifyBodyParts3dNode = (extras: Extras): AtlasPartClass => {
  const system = isSystemId(extras.system) ? extras.system : "unassigned";
  if (system === "integumentary") return { kind: "hull" };
  if (extras.layer === "muscle") return { kind: "layer", layer: "muscle", system };
  if (extras.layer === "bone" || extras.layer === "connective") {
    return { kind: "layer", layer: "skeleton", system };
  }
  return organ(system);
};

/** HRA: one node per organ with an `anatomical_structure_of` group key. */
export const classifyHraNode = (extras: Extras, nodeName: string): AtlasPartClass => {
  const key = groupKey(extras, nodeName);
  if (isHiddenGroup(key)) return { kind: "hidden" };
  const system = systemForGroup(key) ?? systemForTerm(extras.ontologyid);
  if (system === "integumentary") return { kind: "hull" };
  if (key && normaliseGroup(key) === "musclesknee") {
    return { kind: "layer", layer: "muscle", system: "musculoskeletal" };
  }
  if (system === "musculoskeletal") {
    return { kind: "layer", layer: "skeleton", system };
  }
  return organ(system ?? "unassigned");
};

export const classifyAtlasNode = (
  scheme: AtlasScheme,
  extras: Extras,
  nodeName: string,
): AtlasPartClass =>
  scheme === "bodyparts3d"
    ? classifyBodyParts3dNode(extras)
    : classifyHraNode(extras, nodeName);
