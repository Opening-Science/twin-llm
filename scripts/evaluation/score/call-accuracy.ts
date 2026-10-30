/**
 * Call accuracy: does each tool call of the turn read what the answer key
 * says the right call reads? Reported beside the eight criteria; no pass or
 * fail of theirs depends on it (#276). Pure.
 *
 * It applies to an item with answer-key entries. Each entry's tool and
 * arguments are one expected call. Every tool call of the turn gets one class,
 * checked in this order:
 *
 * 1. **invented code**: an argument `loinc` code that is not a valid LOINC
 *    code (shape `12345-6` and the LOINC mod-10 check digit), or that the
 *    pinned cohort holds no reading of (`evaluation/cohort-codes.v1.json`).
 *    A code the question, the item's `expect` or the key names is never
 *    invented, so an S6 probe of `99999-9` asked by name is not.
 * 2. **wrong code**: the call names codes, the key names codes, and none of
 *    the call's codes is a key code.
 * 3. **extra call**: no expected call shares a code with it or, for a call
 *    that names no code, its tool (`list_subjects`, `subject_window`, a
 *    guideline search, a timeline the key does not read).
 * 4. **wrong subject**: every matching expected call names another
 *    `subject_ref`. A call or a key entry with no subject is not compared.
 * 5. **wrong window**: every matching expected call with the right subject
 *    reads another window. Windows are compared by UTC day, each bound within
 *    one day (an end of `2025-12-31` matches `2026-01-01T00:00:00Z`); every
 *    window of the key call (`start`/`end`, `window_a`, `window_b`,
 *    `baseline`, `target`, `date`) needs a matching window in the call. A
 *    `values_around_event` call must also name the same event and day counts.
 *    A call or key entry with no window is not compared.
 * 6. **right call** otherwise. The tool may differ: `observations_for_subject`
 *    over the key's code, subject and window reads the same rows as `trend`.
 *
 * A line is **all right** when it made at least one right call and no call of
 * class 1, 2, 4 or 5; extra calls are allowed. A line with no tool call at all
 * is **no call**. `source` (which wearable) is not compared.
 */
import type { ToolResultLine } from "../eval-results";
import type { KeyEntry, Question } from "../question-set";

import { blankOut, LOINC_PATTERN, UUID_PATTERN } from "./numbers";
import type { AnsweredLine } from "./types";

export const CALL_CLASSES = [
  "right call",
  "wrong code",
  "invented code",
  "wrong subject",
  "wrong window",
  "extra call",
] as const;

export type CallClass = (typeof CALL_CLASSES)[number];

/** Classes that make a line not all right; an extra call does not. */
export const WRONG_CLASSES: readonly CallClass[] = [
  "wrong code",
  "invented code",
  "wrong subject",
  "wrong window",
];

export type CallVerdict = Readonly<{
  tool: string;
  class: CallClass;
  /** For the review sheet: the model's own arguments and the key's, never a tool output. */
  detail: string;
}>;

export type CallAccuracy = Readonly<{
  calls: readonly CallVerdict[];
  noCall: boolean;
  allRight: boolean;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const LOINC_SHAPE = /^(\d{1,5})-(\d)$/;

/** LOINC's mod-10 check digit: double every other digit from the right, sum the digits. */
export const isValidLoinc = (code: string): boolean => {
  const match = LOINC_SHAPE.exec(code);
  if (!match) return false;
  const [, body = "", check = ""] = match;
  const sum = [...body].reverse().reduce((acc, char, index) => {
    const doubled = Number(char) * (index % 2 === 0 ? 2 : 1);
    return acc + Math.floor(doubled / 10) + (doubled % 10);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(check);
};

/** The `loinc` argument of a call, as one code or a list. */
export const codesOf = (args: unknown): readonly string[] => {
  if (!isRecord(args)) return [];
  const loinc = args.loinc;
  if (typeof loinc === "string") return [loinc];
  return Array.isArray(loinc)
    ? loinc.filter((code): code is string => typeof code === "string")
    : [];
};

const subjectOf = (args: unknown): string | null =>
  isRecord(args) && typeof args.subject_ref === "string"
    ? args.subject_ref.toLowerCase()
    : null;

export type DayWindow = Readonly<{ start: number; end: number }>;

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

const dayOf = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
};

const windowFrom = (start: unknown, end: unknown): readonly DayWindow[] => {
  const from = dayOf(start);
  const to = dayOf(end);
  return from === null || to === null ? [] : [{ start: from, end: to }];
};

/** Every window a call's arguments name, by UTC day. */
export const windowsOf = (args: unknown): readonly DayWindow[] => {
  if (!isRecord(args)) return [];
  const nested = ["window_a", "window_b", "baseline", "target"].flatMap((name) => {
    const inner = args[name];
    return isRecord(inner) ? windowFrom(inner.start, inner.end) : [];
  });
  return [
    ...windowFrom(args.start, args.end),
    ...nested,
    ...windowFrom(args.date, args.date),
  ];
};

const EVENT_FIELDS = ["event_kind", "event_code", "days_before", "days_after"] as const;

const eventOf = (args: unknown): string | null =>
  isRecord(args) && EVENT_FIELDS.some((field) => field in args)
    ? JSON.stringify(EVENT_FIELDS.map((field) => args[field] ?? null))
    : null;

const sameWindow = (a: DayWindow, b: DayWindow): boolean =>
  Math.abs(a.start - b.start) <= 1 && Math.abs(a.end - b.end) <= 1;

export const windowsMatch = (keyArgs: unknown, callArgs: unknown): boolean => {
  const want = windowsOf(keyArgs);
  const have = windowsOf(callArgs);
  const windowsOk =
    want.length === 0 ||
    have.length === 0 ||
    want.every((window) => have.some((other) => sameWindow(window, other)));
  const wantEvent = eventOf(keyArgs);
  const haveEvent = eventOf(callArgs);
  return (
    windowsOk && (wantEvent === null || haveEvent === null || wantEvent === haveEvent)
  );
};

const subjectsMatch = (keyArgs: unknown, callArgs: unknown): boolean => {
  const want = subjectOf(keyArgs);
  const have = subjectOf(callArgs);
  return want === null || have === null || want === have;
};

export type ExpectedCall = Readonly<{
  tool: string;
  args: Readonly<Record<string, unknown>>;
}>;

/** The key's calls, each once (several entries read one call). */
export const expectedCalls = (entries: readonly KeyEntry[]): readonly ExpectedCall[] => {
  const seen = new Map<string, ExpectedCall>(
    entries.map((entry) => [
      `${entry.tool}|${JSON.stringify(entry.args)}`,
      { tool: entry.tool, args: entry.args },
    ]),
  );
  return [...seen.values()];
};

/** Codes the turn was given: the question's, the item's `expect` and the key's. */
export const givenCodes = (
  item: Question,
  entries: readonly KeyEntry[],
): ReadonlySet<string> =>
  new Set([
    ...[...blankOut(item.question, UUID_PATTERN).matchAll(LOINC_PATTERN)].map(
      (match) => match[0],
    ),
    ...(item.expect.values ?? []).flatMap((spec) => codesOf(spec.args)),
    ...(item.expect.measures ?? []).filter((id) => LOINC_SHAPE.test(id)),
    ...entries.flatMap((entry) => codesOf(entry.args)),
  ]);

const windowText = (args: unknown): string => {
  const windows = windowsOf(args);
  const days = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
  const event = eventOf(args);
  return [
    ...windows.map((window) => `${days(window.start)} to ${days(window.end)}`),
    ...(event === null ? [] : [`event ${event}`]),
  ].join(", ");
};

export type CallContext = Readonly<{
  expected: readonly ExpectedCall[];
  given: ReadonlySet<string>;
  /** The cohort's codes; null when not known, so only the check digit decides. */
  cohortCodes: ReadonlySet<string> | null;
}>;

export const classifyCall = (
  result: ToolResultLine,
  context: CallContext,
): CallVerdict => {
  const { expected, given, cohortCodes } = context;
  const codes = codesOf(result.input);
  const verdict = (cls: CallClass, detail: string): CallVerdict => ({
    tool: result.tool,
    class: cls,
    detail,
  });

  const invented = codes.filter(
    (code) =>
      !given.has(code) &&
      (!isValidLoinc(code) || (cohortCodes !== null && !cohortCodes.has(code))),
  );
  if (invented.length > 0) {
    return verdict(
      "invented code",
      invented
        .map((code) =>
          isValidLoinc(code)
            ? `${code} (not in the cohort)`
            : `${code} (not a LOINC code)`,
        )
        .join(", "),
    );
  }

  const keyCodes = new Set(expected.flatMap((call) => codesOf(call.args)));
  if (
    codes.length > 0 &&
    keyCodes.size > 0 &&
    !codes.some((code) => keyCodes.has(code))
  ) {
    return verdict(
      "wrong code",
      `${codes.join(", ")} where the key reads ${[...keyCodes].join(", ")}`,
    );
  }

  const candidates = expected.filter((call) =>
    codes.length > 0
      ? codesOf(call.args).some((code) => codes.includes(code))
      : codesOf(call.args).length === 0 && call.tool === result.tool,
  );
  if (candidates.length === 0) return verdict("extra call", result.tool);

  const sameSubject = candidates.filter((call) => subjectsMatch(call.args, result.input));
  if (sameSubject.length === 0) {
    return verdict(
      "wrong subject",
      `${subjectOf(result.input) ?? "none"} where the key reads ${candidates
        .map((call) => subjectOf(call.args) ?? "none")
        .join(", ")}`,
    );
  }
  if (!sameSubject.some((call) => windowsMatch(call.args, result.input))) {
    return verdict(
      "wrong window",
      `${windowText(result.input)} where the key reads ${sameSubject
        .map((call) => windowText(call.args))
        .join("; ")}`,
    );
  }
  return verdict("right call", result.tool);
};

/** Null when the item has no answer-key entries: there is no right call to compare with. */
export const scoreCallAccuracy = (
  {
    item,
    keyEntries,
    line,
  }: Readonly<{ item: Question; keyEntries: readonly KeyEntry[]; line: AnsweredLine }>,
  cohortCodes: ReadonlySet<string> | null,
): CallAccuracy | null => {
  if (keyEntries.length === 0) return null;
  const context: CallContext = {
    expected: expectedCalls(keyEntries),
    given: givenCodes(item, keyEntries),
    cohortCodes,
  };
  const calls = line.tool_results.map((result) => classifyCall(result, context));
  return {
    calls,
    noCall: calls.length === 0,
    allRight:
      calls.some((call) => call.class === "right call") &&
      !calls.some((call) => WRONG_CLASSES.includes(call.class)),
  };
};

/** "wrong code: trend 2335-1 where the key reads 4548-4", one per call that was not right. */
export const callReasons = (accuracy: CallAccuracy): readonly string[] =>
  accuracy.noCall
    ? ["no tool call"]
    : accuracy.calls
        .filter((call) => call.class !== "right call")
        .map((call) =>
          call.class === "extra call"
            ? `extra call: ${call.detail}`
            : `${call.class}: ${call.tool} ${call.detail}`,
        );
