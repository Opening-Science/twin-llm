import { NextResponse } from "next/server";

import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";
import { demoSubjectInScope } from "@/packages/query-tools/synthetic-display";

import { type CohortDeps } from "../biomarkers/cohort-handler";
import {
  MOTION_DAYS_FAILED,
  MOTION_DAYS_NOT_FOUND,
  MOTION_DAYS_SIGN_IN,
} from "./motion-copy";
import { MOTION_DAY_CODES, syntheticMotionDays } from "./motion-days";

/**
 * GET /api/motion/days/:subjectRef: the Demo person's recent wearable days for
 * the twin's motion (`motion-days.ts`), read from their synthetic series under
 * the same synthetic display scope as the Demo's lab values. The rows are
 * synthetic, but the read gets an audit row like any subject read. A failure
 * is logged and answered with a plain sentence.
 */
export const MOTION_DAYS_AUDIT_TOOL = "motion.days";

export type MotionDaysDeps = Pick<
  CohortDeps,
  "resolveActorId" | "findSubject" | "findValues" | "appendAudit"
>;

type DaysContext = { params: Promise<unknown> };

const NO_STORE = { "Cache-Control": "no-store" };

export const createMotionDaysHandler =
  (deps: MotionDaysDeps) => async (_request: Request, context: DaysContext) => {
    const actor = await deps.resolveActorId();
    if (!actor) {
      return NextResponse.json({ error: MOTION_DAYS_SIGN_IN }, { status: 401 });
    }
    const params = (await context.params) as Record<string, unknown>;
    const ref = params.subjectRef;
    if (typeof ref !== "string") {
      return NextResponse.json({ error: MOTION_DAYS_NOT_FOUND }, { status: 404 });
    }
    const audit = (result: unknown, rowCount: number) =>
      deps.appendAudit({
        actor,
        sessionId: actor,
        subjectRef: ref,
        tool: MOTION_DAYS_AUDIT_TOOL,
        args: { codes: MOTION_DAY_CODES },
        result,
        rowCount,
      });
    try {
      if (!demoSubjectInScope(await deps.findSubject(ref))) {
        await audit(SUBJECT_SCOPE_VIOLATION, 0);
        return NextResponse.json({ error: MOTION_DAYS_NOT_FOUND }, { status: 404 });
      }
      const rows = await deps.findValues(ref, MOTION_DAY_CODES);
      const days = syntheticMotionDays(
        rows.map((row) => ({
          loinc: row.loinc,
          value: row.value,
          unitUcum: row.unitUcum,
          effectiveAt: row.effectiveAt.toISOString(),
        })),
      );
      await audit({ days }, days.length);
      return NextResponse.json({ days }, { headers: NO_STORE });
    } catch (error) {
      await audit({ error: "failed" }, 0).catch(() => undefined);
      console.error(
        "[motion] days read failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: MOTION_DAYS_FAILED },
        { status: 502, headers: NO_STORE },
      );
    }
  };
