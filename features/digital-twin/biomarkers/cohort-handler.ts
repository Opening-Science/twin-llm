import { NextResponse } from "next/server";

import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";
import { demoSubjectInScope } from "@/packages/query-tools/synthetic-display";

import { COHORT_VITAL_LOINCS } from "../live/live-rates";
import { COHORT_FAILED } from "./biomarker-copy";

/**
 * Lab values for the Demo body, read from the synthetic B1 cohort under the
 * synthetic display scope (`packages/query-tools/synthetic-display.ts`): only
 * `is_synthetic` rows of a Demo cohort, in any DATA_MODE. The Demo shows a
 * synthetic person and sends nothing to a model, so a personal-mode machine
 * shows it too; the chat's query tools keep their own, stricter scope.
 *
 * The rows are synthetic, but every read still gets an audit row, like any
 * other subject read. A person is shown as "Synthetic person N" in subject_ref
 * order, so the same seed gives the same numbering.
 *
 * The same read also returns the person's newest heart and respiratory rate
 * (G4), apart from the Anchor values, for the live twin, and whether the
 * record lists atrial fibrillation on the heart rate's day, which picks the
 * heart chambers' simulated rhythm (#53). One request, one audit row.
 */
export const COHORT_LIST_AUDIT_TOOL = "biomarkers.cohort.list";
export const COHORT_VALUES_AUDIT_TOOL = "biomarkers.cohort.values";

export const COHORT_SIGN_IN = "Sign in to see synthetic lab values.";
export const COHORT_NOT_FOUND = "No synthetic lab values for this person.";

/**
 * `sex` is the subject's stored FHIR administrative gender when it is female
 * or male (#135), else null; the Demo body and its atlas follow it.
 */
export type CohortPerson = Readonly<{
  ref: string;
  label: string;
  sex: "female" | "male" | null;
}>;

export type CohortSubject = Readonly<{ ref: string; sex: string | null }>;

export type CohortValue = Readonly<{
  loinc: string;
  value: number;
  unitUcum: string;
  effectiveAt: string;
}>;

/** The heart rate's day and whether the record lists AF on it; null without a heart rate. */
export type CohortRhythm = Readonly<{ day: string; afOnDay: boolean }> | null;

export type CohortRow = Readonly<{
  id: string;
  loinc: string;
  value: number;
  unitUcum: string;
  effectiveAt: Date;
}>;

export type CohortDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  /** Synthetic subjects of the allowlisted cohorts with their sex, sorted by subject_ref. */
  listSubjects: () => Promise<readonly CohortSubject[]>;
  findSubject: (
    ref: string,
  ) => Promise<Readonly<{ isSynthetic: boolean; cohortId: string }> | null>;
  /** Every numeric row of the person for these LOINC codes. */
  findValues: (ref: string, loincs: readonly string[]) => Promise<readonly CohortRow[]>;
  /**
   * Whether the person's record lists atrial fibrillation on this day
   * (YYYY-MM-DD), read as the `rhythm_irregularity` tool reads it; the heart
   * chambers' simulated beats follow it (#53).
   */
  afOnDay: (ref: string, day: string) => Promise<boolean>;
  /** The Anchor LOINC codes the tab can show. */
  anchorLoincs: () => readonly string[];
  appendAudit: (input: AppendInput) => Promise<unknown>;
}>;

type ValuesContext = { params: Promise<unknown> };

const NO_STORE = { "Cache-Control": "no-store" };

export const personLabel = (index: number): string => `Synthetic person ${index + 1}`;

const newerFirst = (a: CohortRow, b: CohortRow): number =>
  b.effectiveAt.getTime() - a.effectiveAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The newest row per LOINC. Synthea writes several rows with the same
 * timestamp, so a tie goes to the lower id: a reload always shows the same value.
 */
export const newestPerLoinc = (rows: readonly CohortRow[]): readonly CohortRow[] => {
  const sorted = [...rows].sort(newerFirst);
  return sorted.filter(
    (row, index) => sorted.findIndex((other) => other.loinc === row.loinc) === index,
  );
};

const failed = (where: string, error: unknown) => {
  console.error(where, error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: COHORT_FAILED }, { status: 502, headers: NO_STORE });
};

/** GET /api/biomarkers/cohort: the synthetic people the Demo can borrow lab values from. */
export const createCohortListHandler = (deps: CohortDeps) => async () => {
  const actor = await deps.resolveActorId();
  if (!actor) {
    return NextResponse.json({ error: COHORT_SIGN_IN }, { status: 401 });
  }
  try {
    const rows = await deps.listSubjects();
    const subjects: readonly CohortPerson[] = rows.map((row, index) => ({
      ref: row.ref,
      label: personLabel(index),
      sex: row.sex === "female" || row.sex === "male" ? row.sex : null,
    }));
    await deps.appendAudit({
      actor,
      sessionId: actor,
      subjectRef: null,
      tool: COHORT_LIST_AUDIT_TOOL,
      args: {},
      result: subjects,
      rowCount: subjects.length,
    });
    return NextResponse.json({ subjects }, { headers: NO_STORE });
  } catch (error) {
    return failed("[biomarkers] cohort list failed", error);
  }
};

const VITAL_LOINCS: readonly string[] = Object.values(COHORT_VITAL_LOINCS);

const toValue = (row: CohortRow): CohortValue => ({
  loinc: row.loinc,
  value: row.value,
  unitUcum: row.unitUcum,
  effectiveAt: row.effectiveAt.toISOString(),
});

/** GET /api/biomarkers/cohort/:subjectRef: the newest value per Anchor LOINC, and vitals. */
export const createCohortValuesHandler =
  (deps: CohortDeps) => async (_request: Request, context: ValuesContext) => {
    const actor = await deps.resolveActorId();
    if (!actor) {
      return NextResponse.json({ error: COHORT_SIGN_IN }, { status: 401 });
    }
    const params = (await context.params) as Record<string, unknown>;
    const ref = params.subjectRef;
    if (typeof ref !== "string") {
      return NextResponse.json({ error: COHORT_NOT_FOUND }, { status: 404 });
    }
    const anchor = deps.anchorLoincs();
    const loincs = [...anchor, ...VITAL_LOINCS.filter((code) => !anchor.includes(code))];
    const audit = (result: unknown, rowCount: number) =>
      deps.appendAudit({
        actor,
        sessionId: actor,
        subjectRef: ref,
        tool: COHORT_VALUES_AUDIT_TOOL,
        args: { loincs },
        result,
        rowCount,
      });
    try {
      if (!demoSubjectInScope(await deps.findSubject(ref))) {
        await audit(SUBJECT_SCOPE_VIOLATION, 0);
        return NextResponse.json({ error: COHORT_NOT_FOUND }, { status: 404 });
      }
      const rows = newestPerLoinc(await deps.findValues(ref, loincs));
      const values = rows.filter((row) => anchor.includes(row.loinc)).map(toValue);
      const vitals = rows.filter((row) => VITAL_LOINCS.includes(row.loinc)).map(toValue);
      const heart = vitals.find((row) => row.loinc === COHORT_VITAL_LOINCS.heartRate);
      const day = heart?.effectiveAt.slice(0, 10);
      const rhythm: CohortRhythm =
        day === undefined ? null : { day, afOnDay: await deps.afOnDay(ref, day) };
      await audit({ values, vitals, rhythm }, values.length + vitals.length);
      return NextResponse.json({ values, vitals, rhythm }, { headers: NO_STORE });
    } catch (error) {
      // A read that threw still happened, so it is audited before the 502.
      await audit({ error: "failed" }, 0).catch(() => undefined);
      return failed("[biomarkers] cohort values failed", error);
    }
  };
