import { anchorLayer, type AnchorLayer } from "@/packages/biomarkers/anchor-layer";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import { COHORT_MEASURE_NAMES } from "@/packages/warehouse/cohort-measure-names";

/**
 * A LOINC code's name in words, from the tables the app already keeps: the
 * measures a wearable import stores (`Heart rate` for 8867-4), then the
 * Anchor catalogue's LOINC display up to its property bracket
 * (`Cholesterol [Mass/volume] in Serum or Plasma` reads `Cholesterol`), or
 * Anchor's own short name when the display has no bracket (`HbA1c`), then a
 * short name for the synthetic cohort's other codes (`Systolic blood
 * pressure` for 8480-6, packages/warehouse/cohort-measure-names.ts). Null for
 * a code no table knows; nothing is guessed from the code.
 */

const wearableNames = (): ReadonlyMap<string, string> =>
  new Map(
    Object.values(MEASURES).flatMap((measure) =>
      measure.code === null ? [] : [[measure.code, measure.display] as const],
    ),
  );

const anchorName = (display: string, shortName: string): string => {
  const cut = display.indexOf(" [");
  return cut === -1 ? shortName : display.slice(0, cut).trim();
};

const anchorNames = (layer: AnchorLayer): ReadonlyMap<string, string> =>
  new Map(
    layer.biomarkers.map(
      (marker) =>
        [marker.loincCode, anchorName(marker.loincDisplay, marker.nameDe)] as const,
    ),
  );

/** Wearable names win over Anchor's, and Anchor's over the cohort table's. */
export const catalogueMeasureNames = (
  layer: AnchorLayer = anchorLayer,
): ReadonlyMap<string, string> =>
  new Map([...COHORT_MEASURE_NAMES, ...anchorNames(layer), ...wearableNames()]);

const CATALOGUE = catalogueMeasureNames();

export const catalogueMeasureName = (code: string): string | null =>
  CATALOGUE.get(code) ?? null;
