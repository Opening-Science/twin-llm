/**
 * The stroke oracle: each person's expected stroke hazard, day by day, from
 * Synthea's own calculator (`stroke-calculator.ts`) fed with what their
 * record shows. Pure.
 *
 * Inputs per day: sex; age in whole calendar years; the latest recorded
 * systolic BP (the first one before any is recorded; none: no stroke chance,
 * as the calculator gives -1); the latest recorded smoking status (none:
 * not a smoker); diabetes; AF; and `blood_pressure_controlled` as an option,
 * because Synthea draws it at random visits and never writes it down.
 * `coronary_heart_disease` and `left_ventricular_hypertrophy` are never set
 * in v4.0.0, so they are false.
 *
 * AF and diabetes start before the record shows them. AF's points start the
 * month `atrial_fibrillation.json` sets the attribute, but the condition is
 * written at the next wellness visit (`oracle-facts.ts`); diabetes is set in
 * `metabolic_syndrome_disease.json` and diagnosed at a later visit in
 * `metabolic_syndrome_care.json`. With `onsets: "lagged"` (the default) the
 * true start is taken as evenly spread between the wellness visit before the
 * recorded onset (or 365 days before it when none is in the record) and the
 * recorded onset, and the hazard on a day is the mixture over whether each
 * has started. `"recorded"` starts both on the recorded day.
 */
import { MS_PER_DAY } from "../../packages/query-tools/stats";

import { type Dated, type OracleFacts } from "./oracle-facts";
import {
  type StrokeInputs,
  strokeHazardPerDay,
  type StrokeSex,
} from "./stroke-calculator";

export type OracleSubject = Readonly<{
  sex: StrokeSex;
  /** Day number of the birth date. */
  birth: number;
  /** Day numbers of each birthday from age 1 to 120: age on day d = birthdays <= d. */
  birthdays: readonly number[];
  systolic: readonly (readonly [number, number])[];
  smoker: readonly (readonly [number, boolean])[];
  wellness: readonly number[];
  af: number | null;
  diabetes: number | null;
  hypertension: number | null;
}>;

export type AfScenario = "as recorded" | "on" | "off";

export type OracleOptions = Readonly<{
  /** AF as the record has it (with the onset model), or forced on or off for every day. */
  af: AfScenario;
  onsets: "lagged" | "recorded";
  /** Use the treated BP table from the recorded hypertension onset (an upper bound). */
  bpTreated: "never" | "from hypertension onset";
}>;

export const MAIN: OracleOptions = {
  af: "as recorded",
  onsets: "lagged",
  bpTreated: "never",
};

/** If no wellness visit precedes a recorded onset, assume one a year before. */
export const DEFAULT_VISIT_GAP_DAYS = 365;

const dayNumberOf = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY);

/** Day numbers of the 1st to 120th birthday (29 February falls on 1 March). */
export const birthdaysOf = (birth: string): number[] => {
  const [year, month, date] = birth.split("-").map(Number) as [number, number, number];
  return Array.from({ length: 120 }, (_, i) =>
    Math.floor(Date.UTC(year + i + 1, month - 1, date) / MS_PER_DAY),
  );
};

export const oracleSubject = (
  facts: OracleFacts,
  person: Readonly<{
    sex: StrokeSex;
    birth: string;
    onsets: Readonly<{ af?: string; diabetes?: string; hypertension?: string }>;
  }>,
): OracleSubject => {
  const days = <T>(rows: readonly Dated<T>[]) =>
    rows.map(([day, value]) => [dayNumberOf(day), value] as const);
  const onset = (day: string | undefined) =>
    day === undefined ? null : dayNumberOf(day);
  return {
    sex: person.sex,
    birth: dayNumberOf(person.birth),
    birthdays: birthdaysOf(person.birth),
    systolic: days(facts.systolic),
    smoker: days(facts.smoker),
    wellness: facts.wellness.map(dayNumberOf),
    af: onset(person.onsets.af),
    diabetes: onset(person.onsets.diabetes),
    hypertension: onset(person.onsets.hypertension),
  };
};

/** The latest wellness visit before `recorded`, or a default gap before it. */
export const previousVisit = (wellness: readonly number[], recorded: number): number =>
  wellness.filter((day) => day < recorded).at(-1) ?? recorded - DEFAULT_VISIT_GAP_DAYS;

/**
 * The chance that a condition recorded on `recorded` had started by `day`:
 * 0 up to the visit before, 1 from the recorded day, rising evenly between.
 */
export const startedShare = (
  recorded: number | null,
  previous: number,
  day: number,
  onsets: OracleOptions["onsets"],
): number => {
  if (recorded === null) return 0;
  if (day >= recorded) return 1;
  if (onsets === "recorded" || day <= previous) return 0;
  return (day - previous) / (recorded - previous);
};

/** A cursor over day-sorted values: the latest at or before a day, else the first. */
const latest = <T>(rows: readonly (readonly [number, T])[]) => {
  let index = 0;
  return (day: number): T | null => {
    if (rows.length === 0) return null;
    while (
      index + 1 < rows.length &&
      (rows[index + 1] as readonly [number, T])[0] <= day
    ) {
      index += 1;
    }
    return (rows[index] as readonly [number, T])[1];
  };
};

/**
 * Expected strokes over the days (from, to], one hazard per day, each day
 * read as of its own end. Days must be visited in order, which this does.
 */
export const expectedStrokes = (
  subject: OracleSubject,
  from: number,
  to: number,
  options: OracleOptions = MAIN,
): number => {
  if (to <= from) return 0;
  const systolicOn = latest(subject.systolic);
  const smokerOn = latest(subject.smoker);
  const afPrevious =
    subject.af === null ? 0 : previousVisit(subject.wellness, subject.af);
  const diabetesPrevious =
    subject.diabetes === null ? 0 : previousVisit(subject.wellness, subject.diabetes);
  let age = subject.birthdays.filter((day) => day <= from + 1).length;
  let total = 0;
  for (let day = from + 1; day <= to; day += 1) {
    while (age < subject.birthdays.length && (subject.birthdays[age] as number) <= day) {
      age += 1;
    }
    const base: StrokeInputs = {
      sex: subject.sex,
      ageYears: age,
      systolic: systolicOn(day),
      bpTreated:
        options.bpTreated === "from hypertension onset" &&
        subject.hypertension !== null &&
        day >= subject.hypertension,
      smoker: smokerOn(day) ?? false,
      diabetes: false,
      atrialFibrillation: false,
      coronaryHeartDisease: false,
      leftVentricularHypertrophy: false,
    };
    const af =
      options.af === "on"
        ? 1
        : options.af === "off"
          ? 0
          : startedShare(subject.af, afPrevious, day, options.onsets);
    const diabetes = startedShare(
      subject.diabetes,
      diabetesPrevious,
      day,
      options.onsets,
    );
    for (const [afOn, afWeight] of [
      [false, 1 - af],
      [true, af],
    ] as const) {
      if (afWeight === 0) continue;
      for (const [diabetesOn, diabetesWeight] of [
        [false, 1 - diabetes],
        [true, diabetes],
      ] as const) {
        if (diabetesWeight === 0) continue;
        total +=
          afWeight *
          diabetesWeight *
          strokeHazardPerDay({
            ...base,
            atrialFibrillation: afOn,
            diabetes: diabetesOn,
          });
      }
    }
  }
  return total;
};

/** Expected days with AF on over (from, to] under the onset model. */
export const expectedAfDays = (
  subject: OracleSubject,
  from: number,
  to: number,
  onsets: OracleOptions["onsets"] = "lagged",
): number => {
  if (subject.af === null || to <= from) return 0;
  const previous = previousVisit(subject.wellness, subject.af);
  let total = 0;
  for (let day = from + 1; day <= to; day += 1) {
    total += startedShare(subject.af, previous, day, onsets);
  }
  return total;
};
