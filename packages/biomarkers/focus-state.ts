/**
 * The biomarker state of a twin focus (`packages/anatomy/twin-focus.ts`): the
 * organs of the reviewed organ map (`organ-map.ts`) that fall under it, and
 * per organ the marker furthest from its published range. A focus organ is
 * itself or nothing; a system takes every mapped organ the HRA group table
 * files under it. Pure, so the `twin.body` view and its tests share it.
 */
import { systemForGroup } from "@/packages/anatomy/hra-groups";
import { twinFocus, type TwinFocusId } from "@/packages/anatomy/twin-focus";

import { anchorLayer, type AnchorLayer } from "./anchor-layer";
import { type MarkerValue, ORGAN_MAP, organStatus, type OrganStatus } from "./organ-map";
import { type PopulationContext } from "./population";

/** The mapped organs a focus covers, in organ-map order. */
export const focusOrgans = (id: TwinFocusId): readonly string[] => {
  const focus = twinFocus(id);
  const organs = [...new Set(ORGAN_MAP.map((row) => row.organ))];
  return focus.kind === "organ"
    ? organs.filter((organ) => organ === focus.id)
    : organs.filter((organ) => systemForGroup(organ) === focus.system);
};

/** The LOINC codes to read for a focus; empty when no lab marker maps to it. */
export const focusLoincs = (id: TwinFocusId): readonly string[] => {
  const organs = new Set(focusOrgans(id));
  return ORGAN_MAP.filter((row) => organs.has(row.organ)).map((row) => row.loinc);
};

/** `organStatus` for the organs of one focus only. */
export const focusOrganStatus = (
  id: TwinFocusId,
  values: readonly MarkerValue[],
  context: PopulationContext = {},
  layer: AnchorLayer = anchorLayer,
): readonly OrganStatus[] => {
  const organs = new Set(focusOrgans(id));
  return organStatus(values, context, layer).filter((row) => organs.has(row.organ));
};
