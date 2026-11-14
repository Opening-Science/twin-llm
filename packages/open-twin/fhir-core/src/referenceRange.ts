/**
 * WHAT: Attaches typed reference intervals with mandatory source URL/publisher.
 * NOT:  Must not invent intervals without a source; must not put ranges on the Biomarker entity.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 */
import type { ObservationReferenceRange } from 'fhir/r4';
import { SYSTEMS } from './systems';
import { quantity, type UcumUnit } from './units';

/**
 * Reference intervals, attached to the Observation rather than to the biomarker.
 *
 * This is the Anchor layer's central finding, and it is load-bearing: a reference
 * interval is not a fact about an analyte. It is a property of a specific assay, on a
 * specific instrument, at a specific laboratory, answering a specific question.
 *
 * IMD Berlin's own two published catalogues disagree on ten analytes. HbA1c is the
 * clearest: `< 5,7 %` in the 2025 catalogue and `4,7 - 6,2 %` in the 2015 one. Same
 * laboratory, both correct — one is a diagnostic cutoff, the other a population
 * distribution. A model holding one canonical range per analyte has to discard one of
 * them, and whichever it discards, some question it is later asked has the other as
 * its answer.
 *
 * FHIR already models this correctly. `Observation.referenceRange` is 0..* and sits on
 * the Observation, so several intervals can coexist and be told apart by `type` and
 * `appliesTo`. The naive `(low, high)` columns on a biomarker table are what FHIR
 * declined to do, for the same reason.
 *
 * What FHIR does NOT have is anywhere to record where an interval came from. The
 * Anchor rule is absolute — never from memory, never without a source URL and a
 * retrieval date — so that provenance travels in a declared extension.
 */

export const REFERENCE_RANGE_SOURCE_URL = 'http://opentwin.ch/fhir/StructureDefinition/reference-range-source';

/**
 * `type` distinguishes intervals that answer different questions.
 *
 * These are the codes from the FHIR R4 `referencerange-meaning` value set that the
 * Anchor layer actually uses. `normal` is a population distribution; `treatment` is a
 * therapeutic target; a diagnostic cutoff is `type: recommended` because it recommends
 * a decision boundary rather than describing a population.
 */
export const RANGE_TYPE = {
  /** The distribution seen in a reference population. IMD 2015 HbA1c 4,7-6,2 %. */
  NORMAL: { code: 'normal', display: 'Normal Range' },
  /** A decision boundary from a guideline. IMD 2025 HbA1c < 5,7 %. */
  RECOMMENDED: { code: 'recommended', display: 'Recommended Range' },
  /** A target while under treatment. */
  TREATMENT: { code: 'treatment', display: 'Treatment Range' },
  /** Pre-therapeutic, e.g. a level below which therapy is indicated. */
  PRE_THERAPY: { code: 'pre', display: 'Pre Therapy Range' }
} as const;

export type RangeType = (typeof RANGE_TYPE)[keyof typeof RANGE_TYPE];

export interface ReferenceIntervalSource {
  /**
   * Where the interval was published. Required, with no default: an interval whose
   * origin nobody recorded is exactly the "remembered" tier the Anchor pipeline
   * refuses to write.
   */
  url: string;
  /** Who published it, e.g. 'IMD Berlin, Leistungsverzeichnis'. */
  publisher: string;
  /** ISO date the source was retrieved. A catalogue is a moving target. */
  retrieved: string;
  /** The catalogue's own version or status date, where it states one. */
  version?: string;
}

export interface ReferenceIntervalInput {
  low?: number;
  high?: number;
  unit: UcumUnit;
  type: RangeType;
  source: ReferenceIntervalSource;
  /** Who the interval applies to, e.g. an age band or sex. Free text is honest here. */
  appliesToText?: string;
  /** The interval exactly as the laboratory printed it, e.g. '< 5,7 %'. */
  text?: string;
}

/**
 * One interval, with its provenance attached.
 *
 * A one-sided interval is normal and not an error: `< 5,7 %` has a high and no low,
 * and inventing `low: 0` would assert a boundary the source never published.
 */
export function referenceInterval(input: ReferenceIntervalInput): ObservationReferenceRange {
  if (input.low === undefined && input.high === undefined) {
    throw new TypeError('referenceInterval: an interval needs a low, a high, or both');
  }
  // FHIR has no invariant forbidding low > high, so an inverted interval would validate
  // and then judge every value as out of range. Two swapped columns in a catalogue is a
  // plausible transcription error, and this is the only place it can be caught.
  if (input.low !== undefined && input.high !== undefined && input.low > input.high) {
    throw new TypeError(`referenceInterval: low ${input.low} is above high ${input.high}`);
  }

  const range: ObservationReferenceRange = {
    type: {
      coding: [
        {
          system: SYSTEMS.REFERENCE_RANGE_MEANING,
          code: input.type.code,
          display: input.type.display
        }
      ]
    },
    extension: [
      {
        url: REFERENCE_RANGE_SOURCE_URL,
        extension: [
          { url: 'url', valueUrl: input.source.url },
          { url: 'publisher', valueString: input.source.publisher },
          { url: 'retrieved', valueDate: input.source.retrieved },
          ...(input.source.version ? [{ url: 'version', valueString: input.source.version }] : [])
        ]
      }
    ]
  };

  const low = quantity(input.low, input.unit);
  const high = quantity(input.high, input.unit);
  if (low) range.low = low;
  if (high) range.high = high;
  if (input.appliesToText) range.appliesTo = [{ text: input.appliesToText }];
  if (input.text) range.text = input.text;

  return range;
}

/**
 * German laboratory catalogues write decimals with a comma and thousands with a point:
 * the workbook specifies the format `1.234,000`. FHIR `decimal` is JSON, so it needs a
 * period.
 *
 * Naive parsing is a silent tenfold error that looks entirely plausible in a reference
 * range — `Number('4,7')` is NaN, but a careless `replace(',', '')` turns 4,7 into 47,
 * and an HbA1c upper bound of 47 % is wrong in a way no structural check will catch.
 * So this is explicit, and it rejects rather than guesses.
 */
export function parseGermanDecimal(value: string): number {
  const trimmed = value.trim();
  // Either ungrouped digits, or groups of exactly three after the first point. Anything
  // looser accepts a German date: '12.02.2025' would otherwise strip to 12022025, a
  // large but entirely plausible number. The catalogues carry dates in that form on the
  // same page as the intervals ('Stand 12.02.2025'), so this is a live failure mode.
  if (!/^-?(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/.test(trimmed)) {
    throw new TypeError(`parseGermanDecimal: ${JSON.stringify(value)} is not a German-formatted number`);
  }
  // Points are thousands separators and carry no value; the comma is the decimal point.
  const normalised = trimmed.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`parseGermanDecimal: ${JSON.stringify(value)} did not parse to a finite number`);
  }
  return parsed;
}

/**
 * A laboratory interval as printed, e.g. `4,7 - 6,2`, `< 5,7`, `> 40`, `bis 5,7`.
 * Returns undefined when the text is not an interval this understands — a caller must
 * then abstain rather than receive a guess.
 */
export function parseGermanInterval(text: string): { low?: number; high?: number } | undefined {
  const t = text.trim().replace(/\s+/g, ' ');
  const num = String.raw`-?[\d.]*\d(?:,\d+)?`;

  const between = new RegExp(`^(${num})\\s*(?:-|–|bis)\\s*(${num})$`).exec(t);
  if (between?.[1] && between[2]) {
    return { low: parseGermanDecimal(between[1]), high: parseGermanDecimal(between[2]) };
  }
  const upper = new RegExp(`^(?:<|≤|bis)\\s*(${num})$`).exec(t);
  if (upper?.[1]) return { high: parseGermanDecimal(upper[1]) };

  const lower = new RegExp(`^(?:>|≥|ab)\\s*(${num})$`).exec(t);
  if (lower?.[1]) return { low: parseGermanDecimal(lower[1]) };

  return undefined;
}

// The Anchor-layer category lives in systems.ts as CATEGORY.LABORATORY. A second copy
// here had no consumers and could only ever drift out of step with the first.
