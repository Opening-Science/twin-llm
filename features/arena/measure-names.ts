import { anchorLayer, type AnchorLayer } from "@/packages/biomarkers/anchor-layer";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";

/**
 * A LOINC code's name in words, from the tables the app already keeps: the
 * measures a wearable import stores (`Heart rate` for 8867-4), then the
 * Anchor catalogue's LOINC display up to its property bracket
 * (`Cholesterol [Mass/volume] in Serum or Plasma` reads `Cholesterol`), or
 * Anchor's own short name when the display has no bracket (`HbA1c`). Null
 * for a code neither table knows; nothing is guessed from the code.
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

/** Wearable names win over Anchor's where both name a code. */
export const catalogueMeasureNames = (
  layer: AnchorLayer = anchorLayer,
): ReadonlyMap<string, string> => new Map([...anchorNames(layer), ...wearableNames()]);

const CATALOGUE = catalogueMeasureNames();

export const catalogueMeasureName = (code: string): string | null =>
  CATALOGUE.get(code) ?? null;
