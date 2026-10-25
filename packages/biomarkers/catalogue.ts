/**
 * Lookups over the Anchor catalogue. Every function takes the layer as its last
 * argument (the pinned one by default), so tests can hand in a synthetic layer.
 *
 * `referenceIntervalFor` abstains rather than guesses. It returns an interval
 * only when exactly one of the marker's intervals fits the subject; none or
 * several (DHEA-S at 34 sits in two age bands) give null, and the UI then
 * shows the value without a position.
 */
import {
  anchorLayer,
  type AnchorLayer,
  type Biomarker,
  type ReferenceInterval,
} from "./anchor-layer";
import { parsePopulation, populationMatches, type PopulationContext } from "./population";

export const listBiomarkers = (layer: AnchorLayer = anchorLayer): readonly Biomarker[] =>
  [...layer.biomarkers].sort((a, b) => a.id.localeCompare(b.id));

export const biomarkerById = (
  id: string,
  layer: AnchorLayer = anchorLayer,
): Biomarker | null => layer.biomarkers.find((marker) => marker.id === id) ?? null;

/** Every published interval for a marker, in artefact order. */
export const referenceIntervalsOf = (
  id: string,
  layer: AnchorLayer = anchorLayer,
): readonly ReferenceInterval[] =>
  layer.referenceIntervals.filter((interval) => interval.biomarkerId === id);

/** The one interval that fits the subject, or null when none or several do. */
export const referenceIntervalFor = (
  id: string,
  context: PopulationContext = {},
  layer: AnchorLayer = anchorLayer,
): ReferenceInterval | null => {
  const fitting = referenceIntervalsOf(id, layer).filter((interval) => {
    const population = parsePopulation(interval.population);
    return population !== null && populationMatches(population, context);
  });
  return fitting.length === 1 ? fitting[0]! : null;
};
