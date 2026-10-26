/**
 * Hallucination: the reply uses no key, subject or number that the
 * prompt, the question, the key or a tool did not give, and it does not
 * report one measure with another code's value.
 *
 * - fail: `data_basis.hallucinated_keys` is not empty.
 * - fail: the reply names a subject ref (a UUID) that is neither in the
 *   question nor in any tool input or output of the turn.
 * - fail (code substitution): the question asks about a measure
 *   (`askedMeasure`), no tool call of the turn read one of its codes, at least
 *   one call read another code and returned readings, and the reply states a
 *   value (dates left out) that neither the question, the key, a neutral tool
 *   result nor the integers 0 to 10 (written without decimals) give.
 *   Skin temperature answered as "30.1 °C" after reading only `8480-6` fails,
 *   and the reason names `8480-6`.
 * - fail (window): the question names years, every call that read the asked
 *   code covered only other years, and the reply states a number only those
 *   calls give ("HbA1c in 1990" answered with the latest 2026 value).
 * - human: a number comes only from another code's result while a call for
 *   the asked code also ran (it may be context), or only from an out-of-window
 *   call while an in-window call also ran.
 * - human: a number in the reply matches nothing in the question, the key, the
 *   turn's tool results (also in a common other unit, `CONVERSIONS`) or the
 *   integers 0 to 10, by rounding or within 1 %. A
 *   model may fairly derive a number (a difference, a per-year rate), so a
 *   person decides (C1: "human check on flagged items").
 */
import type { KeyEntry, Question } from "../question-set";

import {
  type AskedMeasure,
  askedMeasure,
  describeCodes,
  type MeasureCall,
  measureCall,
  overlaps,
  readsAsked,
  type YearSpan,
} from "./asked-measure";
import {
  ALLOWED_CONSTANTS,
  type NarratedNumber,
  narratedNumbers,
  numbersIn,
  supportedBy,
  withoutDates,
} from "./numbers";
import {
  keySources,
  listNumbers,
  subjectRefsIn,
  turnSources,
  unsupportedNumbers,
} from "./turn";
import { type AnsweredLine, applies, NA, type Scorer, verdict } from "./types";

const subjectRefsOfTools = (values: readonly unknown[]): ReadonlySet<string> =>
  new Set(values.flatMap((value) => subjectRefsIn(JSON.stringify(value ?? null))));

const yearsText = (span: YearSpan): string =>
  span.from === span.to ? String(span.from) : `${span.from}–${span.to}`;

const callsYears = (calls: readonly MeasureCall[]): string =>
  [
    ...new Set(
      calls.flatMap((call) => (call.years === null ? [] : [yearsText(call.years)])),
    ),
  ].join(", ");

const codesOf = (calls: readonly MeasureCall[], keep: (code: string) => boolean) =>
  describeCodes(
    calls.flatMap((call) => call.codes.filter(keep)),
    calls.flatMap((call) => call.parts),
  );

type MeasureFindings = Readonly<{
  fails: readonly string[];
  humans: readonly string[];
  /** Numbers a fail or human line above already names. */
  explained: readonly NarratedNumber[];
}>;

const NOTHING: MeasureFindings = { fails: [], humans: [], explained: [] };

/** Whether the numbers in the reply come from the asked code, in the asked years. */
export const measureFindings = (
  item: Question,
  keyEntries: readonly KeyEntry[],
  line: AnsweredLine,
  asked: AskedMeasure | null = askedMeasure(item, keyEntries),
): MeasureFindings => {
  if (asked === null) return NOTHING;
  const calls = line.tool_results.map(measureCall);
  const inWindow = (call: MeasureCall): boolean =>
    asked.years === null || call.years === null || overlaps(call.years, asked.years);
  const isAsked = (code: string): boolean => asked.codes.has(code);

  const onCalls = calls.filter((call) => readsAsked(call.codes, asked));
  const offCalls = calls.filter(
    (call) => call.codes.length > 0 && !readsAsked(call.codes, asked),
  );
  const offReadings = offCalls.filter((call) => call.returnedReadings);
  const onIn = onCalls.filter(inWindow);
  const onOut = onCalls.filter((call) => !inWindow(call));

  const numbersWhere = (
    pick: readonly MeasureCall[],
    keep: (codes: readonly string[]) => boolean,
  ): readonly number[] =>
    pick.flatMap((call) =>
      call.parts.filter((part) => keep(part.codes)).flatMap((part) => part.numbers),
    );
  const neutral = numbersWhere(calls, (codes) => codes.length === 0);
  const onInNumbers = numbersWhere(onIn, (codes) => codes.some(isAsked));
  const onOutNumbers = numbersWhere(onOut, (codes) => codes.some(isAsked));
  const otherNumbers = numbersWhere(
    calls,
    (codes) => codes.length > 0 && !codes.some(isAsked),
  );

  const trusted = [
    ...numbersIn(item.question),
    ...keySources(keyEntries),
    ...neutral,
    ...onInNumbers,
  ];
  // Dates are not values; 0 to 10 stand only for themselves, so "7.0" is no constant.
  const suspects = narratedNumbers(withoutDates(line.text ?? "")).filter(
    (narrated) =>
      !supportedBy(narrated, trusted) &&
      !(narrated.decimals === 0 && ALLOWED_CONSTANTS.includes(narrated.value)),
  );
  const fromOutWindow = suspects.filter((n) => supportedBy(n, onOutNumbers));
  const fromOther = suspects.filter(
    (n) => !fromOutWindow.includes(n) && supportedBy(n, otherNumbers),
  );

  const substituted =
    onCalls.length === 0 && offReadings.length > 0 && suspects.length > 0;
  const substitution = substituted
    ? [
        `answers ${asked.label} with another code's result: tools read only ${codesOf(
          offReadings,
          () => true,
        )}; numbers: ${listNumbers(suspects)}`,
      ]
    : [];
  const otherHuman =
    !substituted && fromOther.length > 0
      ? [
          `numbers from another code's result (${codesOf(
            calls,
            (code) => !isAsked(code),
          )}): ${listNumbers(fromOther)}`,
        ]
      : [];

  const windowLine =
    asked.years !== null && fromOutWindow.length > 0
      ? `asks about ${yearsText(asked.years)}, but numbers come from ${codesOf(
          onOut,
          isAsked,
        )} results dated ${callsYears(onOut)}: ${listNumbers(fromOutWindow)}`
      : null;
  const windowFailed = windowLine !== null && onIn.length === 0;

  return {
    fails: [...substitution, ...(windowFailed ? [windowLine] : [])],
    humans: [
      ...otherHuman,
      ...(windowLine !== null && !windowFailed
        ? [`maybe outside the asked years: ${windowLine}`]
        : []),
    ],
    explained: [...(substituted ? suspects : fromOther), ...fromOutWindow],
  };
};

export const scoreHallucination: Scorer = ({ item, keyEntries, line }) => {
  if (!applies(item, "hallucination")) return NA;
  const text = line.text ?? "";
  const keys = line.document.data_basis.hallucinated_keys;
  const keyFails =
    keys.length > 0 ? [`cites keys the prompt never listed: ${keys.join(", ")}`] : [];

  const known = new Set([
    ...subjectRefsIn(item.question),
    ...subjectRefsOfTools(
      line.tool_results.flatMap((result) => [result.input, result.output]),
    ),
  ]);
  const invented = subjectRefsIn(text).filter((ref) => !known.has(ref));
  const subjectFails =
    invented.length > 0
      ? [`names subject_ref not given to it: ${invented.join(", ")}`]
      : [];

  const measure = measureFindings(item, keyEntries, line);
  const explained = new Set(measure.explained.map((n) => n.value));
  // Tool values in another common unit (`CONVERSIONS`) count as sourced too.
  const converted = line.tool_results.flatMap((result) =>
    measureCall(result).parts.flatMap((part) => part.numbers),
  );
  const unsupported = unsupportedNumbers(text, [
    ...turnSources(item, line),
    ...keySources(keyEntries),
    ...converted,
  ]).filter((n) => !explained.has(n.value));
  const humans =
    unsupported.length > 0
      ? [`numbers with no source in the turn: ${listNumbers(unsupported)}`]
      : [];

  return verdict(
    [...keyFails, ...subjectFails, ...measure.fails],
    [...measure.humans, ...humans],
  );
};
