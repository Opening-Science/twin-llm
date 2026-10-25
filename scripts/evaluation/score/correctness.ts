/**
 * Correctness: the host fields match the case the item was written for,
 * and the keyed values are in the answer.
 *
 * - fail: a host field differs from `expect` (`"any"` matches anything;
 *   `uncertainty.reasons` must all appear, others may too).
 * - fail: the key holds no value for the item (a null value or a refusal) and
 *   the answer states a number that is not from the question, a tool result or
 *   the integers 0 to 10. There was nothing it could come from.
 * - human: a keyed number is not found in the reply, is found without its
 *   unit, or a delta or slope is found with the opposite sign ("sign
 *   differs"). The finder is a heuristic, so a miss goes to a person (C2).
 * - pass: everything else.
 */
import type { KeyEntry, Question } from "../question-set";

import {
  narratedNumbers,
  roundsTo,
  signDiffers,
  targetsFor,
  unitFollows,
  withinTolerance,
} from "./numbers";
import { keyHoldsNoValue, listNumbers, turnSources, unsupportedNumbers } from "./turn";
import { type AnsweredLine, applies, NA, type Scorer, verdict } from "./types";

type Expect = Question["expect"];

const hostFieldMismatches = (expect: Expect, line: AnsweredLine): string[] => {
  const doc = line.document;
  const checks: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["answer_class", expect.answer_class, doc.answer_class],
    ["sufficient_data", expect.sufficient_data, doc.sufficient_data],
    ["abstained", expect.abstained, doc.abstained],
    ["uncertainty.level", expect.uncertainty.level, doc.uncertainty.level],
    ["next_step", expect.next_step, doc.next_step],
    ["interpretation.kind", expect.interpretation_kind, doc.interpretation.kind],
  ];
  const fields = checks
    .filter(([, expected, actual]) => expected !== "any" && expected !== actual)
    .map(
      ([field, expected, actual]) =>
        `${field}: expected ${String(expected)}, got ${String(actual)}`,
    );
  const missingReasons = expect.uncertainty.reasons.filter(
    (reason) => !doc.uncertainty.reasons.includes(reason),
  );
  return missingReasons.length > 0
    ? [...fields, `uncertainty.reasons: missing ${missingReasons.join(", ")}`]
    : fields;
};

export type ValueFinding = Readonly<{
  name: string;
  found: boolean;
  /** Matched at a per-year rate (a daily slope narrated per year). */
  perYear: boolean;
  withUnit: boolean;
  /** A delta or slope was found only with the opposite sign. */
  signDiffers: boolean;
}>;

/** Keyed values whose sign carries meaning: a change, not a level. */
export const SIGNED_PATH = /slope|delta/;

/** Finds one keyed number in the reply, by its rounding or its tolerance. */
export const findKeyedValue = (
  text: string,
  entry: KeyEntry,
  tolerance: Parameters<typeof withinTolerance>[2],
): ValueFinding => {
  const value = entry.value;
  if (typeof value !== "number") {
    return {
      name: entry.name,
      found: false,
      perYear: false,
      withUnit: false,
      signDiffers: false,
    };
  }
  const targets = targetsFor(entry.path, value);
  const matches = narratedNumbers(text).flatMap((narrated) =>
    targets.flatMap((target, index) =>
      withinTolerance(narrated, target, tolerance) ||
      roundsTo(narrated, target, entry.unit)
        ? [{ narrated, perYear: index > 0 }]
        : [],
    ),
  );
  const withUnit = matches.some(
    ({ narrated, perYear }) =>
      entry.unit === null || unitFollows(text, narrated, entry.unit, perYear),
  );
  const signed = SIGNED_PATH.test(entry.path);
  return {
    name: entry.name,
    found: matches.length > 0,
    perYear: matches.some((match) => match.perYear),
    withUnit,
    signDiffers:
      signed &&
      matches.length > 0 &&
      matches.every(({ narrated }) => signDiffers(narrated, value)),
  };
};

/** The tolerance the question set gave this value; exact when the item has none. */
export const toleranceFor = (item: Question, entry: KeyEntry) =>
  item.expect.values?.find((spec) => spec.name === entry.name)?.tolerance ?? {
    exact: true as const,
  };

export const scoreCorrectness: Scorer = ({ item, keyEntries, line }) => {
  if (!applies(item, "correctness")) return NA;
  const text = line.text ?? "";
  const fails = hostFieldMismatches(item.expect, line);

  const noValue = keyHoldsNoValue(keyEntries);
  const stated =
    noValue.length > 0 ? unsupportedNumbers(text, turnSources(item, line)) : [];
  const noValueFails =
    stated.length > 0
      ? [
          `states ${listNumbers(stated)} where the key holds no value (${noValue
            .map((entry) => entry.name)
            .join(", ")})`,
        ]
      : [];

  const humans = keyEntries
    .filter((entry) => typeof entry.value === "number")
    .map((entry) => findKeyedValue(text, entry, toleranceFor(item, entry)))
    .flatMap((finding) => {
      if (!finding.found) return [`value ${finding.name} not found in the reply`];
      return [
        ...(finding.withUnit ? [] : [`value ${finding.name} found without its unit`]),
        ...(finding.signDiffers ? [`value ${finding.name}: sign differs`] : []),
      ];
    });

  return verdict([...fails, ...noValueFails], humans);
};
