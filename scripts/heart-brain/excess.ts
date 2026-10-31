/**
 * What drives the stroke excess after AF onset (#323): the stroke
 * calculator's inputs as Synthea saw them, month by month, against what the
 * FHIR record lets the oracle (`oracle.ts`) see. Pure.
 *
 * The inputs come from an instrumented run of the pinned jar with one extra
 * module, `synthea-monitor/excess_monitor.json`. It waits on the same 1-month
 * delay as `stroke.json`, so it wakes at the very time steps the stroke
 * module draws, and from age 50 and 2014 it passes through states whose
 * names carry the `stroke_risk` attribute (binned to the 10-year table value
 * it came from) and the calculator's flags: `blood_pressure_controlled`,
 * `diabetes`, `atrial_fibrillation`, `smoker` and `hypertension`. It writes
 * nothing to the record and draws no random number (writing observations
 * would: every record entry takes a UUID from the person's generator), so
 * the FHIR files are byte for byte those of the same run without it. The
 * JSON exporter's module history (`exporter.json.include_module_history`)
 * gives the states back with their times.
 *
 * Systolic BP is not read by the module, since reading a vital sign can draw
 * from the generator. It is recovered from the calculator itself: the 10-year
 * risk gives the total points, and the total minus age, smoking, diabetes and
 * AF points is the BP points the calculator used.
 */
import { MS_PER_DAY } from "../../packages/query-tools/stats";

import { type Person } from "../../packages/query-tools/event-rates/cohort";
import {
  expectedStrokes,
  type OracleOptions,
  type OracleSubject,
  previousVisit,
  startedShare,
} from "./oracle";
import {
  AGE_STROKE,
  ATRIAL_FIBRILLATION_STROKE_POINTS,
  DIABETES_STROKE,
  indexInRangeList,
  riskPerTimestep,
  type StrokeInputs,
  strokeChancePerCheck,
  type StrokeSex,
  TEN_YEAR_STROKE_RISK,
  TREATED_SYS_BP_STROKE,
  UNTREATED_SYS_BP_STROKE,
} from "./stroke-calculator";
import {
  BEFORE,
  personPieces,
  type TimingSpec,
} from "../../packages/query-tools/event-rates/within-person";

/** One wake of the monitor: the inputs the calculator had at that time step. */
export type MonitorCheck = Readonly<{
  /** Epoch ms of the time step. */
  at: number;
  /** The 10-year risk behind `stroke_risk`; null when the calculator gave -1. */
  tenYear: number | null;
  bpControlled: boolean;
  diabetes: boolean;
  af: boolean;
  smoker: boolean;
  hypertension: boolean;
}>;

type HistoryState = Readonly<{ state_name: string; entered: number }>;

const isHistoryState = (value: unknown): value is HistoryState =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { state_name?: unknown }).state_name === "string" &&
  typeof (value as { entered?: unknown }).entered === "number";

const FLAGS = ["bpc", "dm", "af", "smk", "htn"] as const;

/**
 * The monitor's wakes from its module history (any order), oldest first.
 * A wake is the `R_<risk>` state and the five flag states entered at the
 * same time; a wake missing any of them is dropped.
 */
export const monitorChecks = (history: readonly unknown[]): MonitorCheck[] => {
  const byTime = new Map<number, Map<string, string>>();
  for (const state of history.filter(isHistoryState)) {
    const match = /^(R|bpc|dm|af|smk|htn)_(.+)$/.exec(state.state_name);
    if (match === null || match[2] === "check") continue;
    const at = byTime.get(state.entered) ?? new Map<string, string>();
    at.set(match[1] as string, match[2] as string);
    byTime.set(state.entered, at);
  }
  return [...byTime.entries()]
    .flatMap(([at, values]): MonitorCheck[] => {
      const risk = values.get("R");
      if (risk === undefined || FLAGS.some((flag) => !values.has(flag))) return [];
      const tenYear = risk === "neg" ? null : Number(risk);
      if (tenYear !== null && !Number.isFinite(tenYear)) return [];
      const on = (flag: (typeof FLAGS)[number]) => values.get(flag) === "1";
      return [
        {
          at,
          tenYear,
          bpControlled: on("bpc"),
          diabetes: on("dm"),
          af: on("af"),
          smoker: on("smk"),
          hypertension: on("htn"),
        },
      ];
    })
    .sort((a, b) => a.at - b.at);
};

/** Times a named state was entered in a module history, oldest first. */
export const enteredTimes = (history: readonly unknown[], name: string): number[] =>
  history
    .filter(isHistoryState)
    .filter((state) => state.state_name === name)
    .map((state) => state.entered)
    .sort((a, b) => a - b);

/** UTC day number of an epoch-ms time. */
export const dayOfMs = (ms: number): number => Math.floor(ms / MS_PER_DAY);

const sexIndex = (sex: StrokeSex): 0 | 1 => (sex === "M" ? 0 : 1);

/**
 * The total points behind a 10-year risk in the table for `sex` (from age
 * 55), lowest first, and whether the risk is the table's last value (then
 * any total from the last index up gives it). Empty for the fixed rates
 * under 55.
 */
export const pointsForRisk = (
  sex: StrokeSex,
  tenYear: number,
): Readonly<{ totals: number[]; capped: boolean }> => {
  const table = TEN_YEAR_STROKE_RISK[sexIndex(sex)] as readonly number[];
  const totals = table.flatMap((value, index) => (value === tenYear ? [index] : []));
  return { totals, capped: totals.at(-1) === table.length - 1 };
};

/** Points from everything but BP, as the calculator adds them (no LVH or CHD in v4.0.0). */
export const pointsWithoutBp = (
  sex: StrokeSex,
  ageYears: number,
  flags: Readonly<{ smoker: boolean; diabetes: boolean; af: boolean }>,
): number => {
  const s = sexIndex(sex);
  return (
    (flags.smoker ? 3 : 0) +
    indexInRangeList(ageYears, AGE_STROKE[s] as readonly number[]) +
    (flags.diabetes ? DIABETES_STROKE[s] : 0) +
    (flags.af ? ATRIAL_FIBRILLATION_STROKE_POINTS[s] : 0)
  );
};

/** Highest BP points either table can give. */
export const MAX_BP_POINTS = (UNTREATED_SYS_BP_STROKE[0] as readonly number[]).length - 1;

/**
 * The BP points the calculator used at a check, from age 55: total points
 * minus the rest. Null under 55 or with no risk; `ambiguous` when the table
 * repeats the risk value and more than one BP points value fits (the lowest
 * is returned then).
 */
export const bpPointsAt = (
  sex: StrokeSex,
  ageYears: number,
  check: MonitorCheck,
): Readonly<{ points: number; ambiguous: boolean }> | null => {
  if (check.tenYear === null || ageYears < 55) return null;
  const rest = pointsWithoutBp(sex, ageYears, check);
  const { totals, capped } = pointsForRisk(sex, check.tenYear);
  const bps = Array.from({ length: MAX_BP_POINTS + 1 }, (_, bp) => bp);
  const fits = bps.filter(
    (bp) =>
      totals.includes(rest + bp) || (capped && rest + bp >= (totals.at(-1) as number)),
  );
  if (fits.length === 0) return null;
  return { points: fits[0] as number, ambiguous: fits.length > 1 };
};

/** BP points the oracle's inputs give: the untreated table unless treated. */
export const recordBpPoints = (
  sex: StrokeSex,
  systolic: number,
  treated: boolean,
): number =>
  indexInRangeList(
    Math.trunc(systolic),
    (treated ? TREATED_SYS_BP_STROKE : UNTREATED_SYS_BP_STROKE)[
      sexIndex(sex)
    ] as readonly number[],
  );

/** The chance at one check from 55, given total points (the table's last value past its end). */
export const chanceFromPoints = (sex: StrokeSex, points: number): number => {
  const table = TEN_YEAR_STROKE_RISK[sexIndex(sex)] as readonly number[];
  return Math.max(
    0,
    riskPerTimestep(table[Math.min(points, table.length - 1)] as number),
  );
};

/** The latest value at or before `day` in day-sorted rows, else the first, else null. */
export const latestOn = <T>(
  rows: readonly (readonly [number, T])[],
  day: number,
): T | null => {
  if (rows.length === 0) return null;
  let found = (rows[0] as readonly [number, T])[1];
  for (const [at, value] of rows) {
    if (at > day) break;
    found = value;
  }
  return found;
};

/** What the oracle sees on a day: one value per input, AF and diabetes as started shares. */
export type RecordInputs = Readonly<{
  ageYears: number;
  systolic: number | null;
  smoker: boolean;
  afShare: number;
  diabetesShare: number;
}>;

export const recordInputsOn = (
  subject: OracleSubject,
  day: number,
  onsets: OracleOptions["onsets"] = "lagged",
): RecordInputs => {
  const share = (recorded: number | null) =>
    recorded === null
      ? 0
      : startedShare(recorded, previousVisit(subject.wellness, recorded), day, onsets);
  return {
    ageYears: subject.birthdays.filter((birthday) => birthday <= day).length,
    systolic: latestOn(subject.systolic, day),
    smoker: latestOn(subject.smoker, day) ?? false,
    afShare: share(subject.af),
    diabetesShare: share(subject.diabetes),
  };
};

/** Which inputs come from Synthea's own state instead of the record. */
export type TrueInputs = Readonly<{
  af: boolean;
  diabetes: boolean;
  smoker: boolean;
  /** The BP points the calculator used (value and table). */
  bp: boolean;
  /** Only the table: the recorded BP, read with the treated table when controlled. */
  bpTable: boolean;
}>;

export const NONE_TRUE: TrueInputs = {
  af: false,
  diabetes: false,
  smoker: false,
  bp: false,
  bpTable: false,
};
export const ALL_TRUE: TrueInputs = {
  af: true,
  diabetes: true,
  smoker: true,
  bp: true,
  bpTable: true,
};

/**
 * The chance at one check with some inputs taken from the monitor and the
 * rest from the record, averaged over AF and diabetes shares as the oracle
 * does. When true BP is asked for but cannot be recovered (under 55, or a
 * risk the other inputs cannot give), BP stays the record's.
 */
export const chanceAt = (
  sex: StrokeSex,
  record: RecordInputs,
  check: MonitorCheck,
  use: TrueInputs,
): number => {
  const trueBp = use.bp ? bpPointsAt(sex, record.ageYears, check) : null;
  const smoker = use.smoker ? check.smoker : record.smoker;
  const mix = (share: number, truth: boolean, take: boolean) =>
    take
      ? [[truth, 1] as const]
      : ([
          [false, 1 - share],
          [true, share],
        ] as const);
  let total = 0;
  for (const [af, afWeight] of mix(record.afShare, check.af, use.af)) {
    if (afWeight === 0) continue;
    for (const [diabetes, dmWeight] of mix(
      record.diabetesShare,
      check.diabetes,
      use.diabetes,
    )) {
      if (dmWeight === 0) continue;
      const inputs: StrokeInputs = {
        sex,
        ageYears: record.ageYears,
        systolic: record.systolic,
        bpTreated: use.bpTable && check.bpControlled,
        smoker,
        diabetes,
        atrialFibrillation: af,
        coronaryHeartDisease: false,
        leftVentricularHypertrophy: false,
      };
      const chance =
        trueBp !== null
          ? chanceFromPoints(
              sex,
              pointsWithoutBp(sex, record.ageYears, { smoker, diabetes, af }) +
                trueBp.points,
            )
          : strokeChancePerCheck(inputs);
      total += afWeight * dmWeight * chance;
    }
  }
  return total;
};

/** The chance Synthea drew with at a check: the 7-day conversion of the 10-year risk. */
export const trueChance = (check: MonitorCheck): number =>
  check.tenYear === null ? 0 : Math.max(0, riskPerTimestep(check.tenYear));

/** Expected strokes with one input at a time taken from Synthea's state, then all. */
export const VARIANTS = {
  record: NONE_TRUE,
  trueAf: { ...NONE_TRUE, af: true },
  trueDiabetes: { ...NONE_TRUE, diabetes: true },
  trueSmoker: { ...NONE_TRUE, smoker: true },
  trueBpTable: { ...NONE_TRUE, bpTable: true },
  trueBp: { ...NONE_TRUE, bp: true },
  allButBp: { ...ALL_TRUE, bp: false, bpTable: false },
  allTrue: ALL_TRUE,
} as const satisfies Record<string, TrueInputs>;

export type VariantName = keyof typeof VARIANTS;

export type SideSums = Readonly<{
  days: number;
  observed: number;
  /** `expectedStrokes` (main options) over the same pieces. */
  oracle: number;
  /** Checks the monitor saw inside the pieces. */
  checks: number;
  /** Sum of the chance Synthea drew with at those checks. */
  truth: number;
  variants: Readonly<Record<VariantName, number>>;
  /** Checks from 55 with BP points recovered, and of those ambiguous. */
  bpRecovered: number;
  bpAmbiguous: number;
  /** Sum of true minus record BP points over recovered checks with a recorded BP. */
  bpPointsGain: number;
  /** Checks with `blood_pressure_controlled` on. */
  bpControlled: number;
  /**
   * Recovered checks with a recorded BP whose true BP points equal the
   * record's BP read with the table Synthea used (treated when controlled),
   * split by `blood_pressure_controlled`; and the number compared.
   */
  bpSameBandControlled: number;
  bpComparedControlled: number;
  bpSameBandUncontrolled: number;
  bpComparedUncontrolled: number;
  /** Expected strokes added by true BP, split by `blood_pressure_controlled`. */
  bpGainControlled: number;
  bpGainUncontrolled: number;
  /** Checks where the record's AF share or diabetes share disagrees with Synthea's flag. */
  afDisagree: number;
  diabetesDisagree: number;
}>;

const variantNames = Object.keys(VARIANTS) as VariantName[];

export const emptySums = (): SideSums => ({
  days: 0,
  observed: 0,
  oracle: 0,
  checks: 0,
  truth: 0,
  variants: Object.fromEntries(variantNames.map((name) => [name, 0])) as Record<
    VariantName,
    number
  >,
  bpRecovered: 0,
  bpAmbiguous: 0,
  bpPointsGain: 0,
  bpControlled: 0,
  bpSameBandControlled: 0,
  bpComparedControlled: 0,
  bpSameBandUncontrolled: 0,
  bpComparedUncontrolled: 0,
  bpGainControlled: 0,
  bpGainUncontrolled: 0,
  afDisagree: 0,
  diabetesDisagree: 0,
});

export const addSums = (a: SideSums, b: SideSums): SideSums => ({
  days: a.days + b.days,
  observed: a.observed + b.observed,
  oracle: a.oracle + b.oracle,
  checks: a.checks + b.checks,
  truth: a.truth + b.truth,
  variants: Object.fromEntries(
    variantNames.map((name) => [name, a.variants[name] + b.variants[name]]),
  ) as Record<VariantName, number>,
  bpRecovered: a.bpRecovered + b.bpRecovered,
  bpAmbiguous: a.bpAmbiguous + b.bpAmbiguous,
  bpPointsGain: a.bpPointsGain + b.bpPointsGain,
  bpControlled: a.bpControlled + b.bpControlled,
  bpSameBandControlled: a.bpSameBandControlled + b.bpSameBandControlled,
  bpComparedControlled: a.bpComparedControlled + b.bpComparedControlled,
  bpSameBandUncontrolled: a.bpSameBandUncontrolled + b.bpSameBandUncontrolled,
  bpComparedUncontrolled: a.bpComparedUncontrolled + b.bpComparedUncontrolled,
  bpGainControlled: a.bpGainControlled + b.bpGainControlled,
  bpGainUncontrolled: a.bpGainUncontrolled + b.bpGainUncontrolled,
  afDisagree: a.afDisagree + b.afDisagree,
  diabetesDisagree: a.diabetesDisagree + b.diabetesDisagree,
});

/** A check's share of an input "disagrees" when the record's share is not the flag. */
const disagrees = (share: number, flag: boolean): boolean => share !== (flag ? 1 : 0);

/**
 * One person's sums before and after the recorded AF onset, on the
 * within-person cohort's pieces (`personPieces`, cohort mode), or null when
 * they have no counted time. Checks count in the piece (from, to] that holds
 * their UTC day, so a stroke check on the stroke day counts.
 */
export const personExcess = (
  person: Person,
  subject: OracleSubject,
  checks: readonly MonitorCheck[],
  spec: TimingSpec,
): Readonly<{ before: SideSums; after: SideSums }> | null => {
  const pieces = personPieces(person, spec);
  if (pieces === null || person.sex === null) return null;
  const sex = person.sex;
  const sides = { before: emptySums(), after: emptySums() };
  for (const piece of pieces) {
    const side = piece.window === BEFORE ? "before" : "after";
    const inPiece = checks.filter((check) => {
      const day = dayOfMs(check.at);
      return day > piece.from && day <= piece.to;
    });
    let sums: SideSums = {
      ...emptySums(),
      days: piece.days,
      observed: piece.event ? 1 : 0,
      oracle: expectedStrokes(subject, piece.from, piece.to),
      checks: inPiece.length,
    };
    for (const check of inPiece) {
      const record = recordInputsOn(subject, dayOfMs(check.at));
      const chances = Object.fromEntries(
        variantNames.map((name) => [name, chanceAt(sex, record, check, VARIANTS[name])]),
      ) as Record<VariantName, number>;
      const bp = bpPointsAt(sex, record.ageYears, check);
      const gain = chances.trueBp - chances.record;
      const compared = bp !== null && !bp.ambiguous && record.systolic !== null;
      const sameBand =
        compared &&
        bp.points === recordBpPoints(sex, record.systolic as number, check.bpControlled);
      const one: SideSums = {
        ...emptySums(),
        truth: trueChance(check),
        variants: chances,
        bpRecovered: bp === null ? 0 : 1,
        bpAmbiguous: bp?.ambiguous === true ? 1 : 0,
        bpPointsGain:
          bp === null || record.systolic === null
            ? 0
            : bp.points - recordBpPoints(sex, record.systolic, false),
        bpControlled: check.bpControlled ? 1 : 0,
        bpSameBandControlled: check.bpControlled && sameBand ? 1 : 0,
        bpComparedControlled: check.bpControlled && compared ? 1 : 0,
        bpSameBandUncontrolled: !check.bpControlled && sameBand ? 1 : 0,
        bpComparedUncontrolled: !check.bpControlled && compared ? 1 : 0,
        bpGainControlled: check.bpControlled ? gain : 0,
        bpGainUncontrolled: check.bpControlled ? 0 : gain,
        afDisagree: disagrees(record.afShare, check.af) ? 1 : 0,
        diabetesDisagree: disagrees(record.diabetesShare, check.diabetes) ? 1 : 0,
      };
      sums = addSums(sums, one);
    }
    sides[side] = addSums(sides[side], sums);
  }
  return sides;
};

/** Where Synthea's AF start falls against the oracle's assumed window. */
export type AfTiming = "in window" | "before previous visit" | "after recorded onset";

/**
 * The oracle assumes AF starts between the wellness visit before the
 * recorded onset and the recorded onset. `trueDay` is the day
 * `atrial_fibrillation.json` entered its `Diagnosis` state (the attribute is
 * set then).
 */
export const afTiming = (
  trueDay: number,
  recordedDay: number,
  wellness: readonly number[],
): AfTiming => {
  if (trueDay > recordedDay) return "after recorded onset";
  return trueDay > previousVisit(wellness, recordedDay) || trueDay === recordedDay
    ? "in window"
    : "before previous visit";
};
