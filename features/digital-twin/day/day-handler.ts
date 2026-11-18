import { NextResponse } from "next/server";
import { z } from "zod";

import { GLUCOSE_PROFILES, type GlucoseProfile } from "@/packages/query-tools/day-beats";
import { windowEndDate, windowStartDate } from "@/packages/query-tools/schemas";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";
import { demoSubjectInScope } from "@/packages/query-tools/synthetic-display";

import { type CohortDeps } from "../biomarkers/cohort-handler";
import {
  DAY_BAD_REQUEST,
  DAY_FAILED,
  DAY_NOT_FOUND,
  DAY_REFUSED,
  DAY_SIGN_IN,
  PERIOD_REFUSED,
} from "./day-copy";
import { DAY_CODES, dayList, demoDay, mockDay } from "./demo-day";
import { demoPeriod, type Period, PERIOD_CODES, periodRead } from "./demo-period";

/**
 * Routes behind "Show me my day". A person's days and a person's day are read
 * like the Demo's lab values: the subject is checked against the Demo cohorts
 * first, the rows come through the same Demo-only read, and every read gets an
 * audit row. The mock day reads no subject, so it has no audit row.
 */
export const DAY_LIST_AUDIT_TOOL = "digital-twin.day.list";
export const DAY_AUDIT_TOOL = "digital-twin.day";
export const PERIOD_AUDIT_TOOL = "digital-twin.period";

export type DayDeps = Pick<
  CohortDeps,
  "resolveActorId" | "findSubject" | "findValues" | "appendAudit"
>;

type SubjectContext = { params: Promise<unknown> };

const NO_STORE = { "Cache-Control": "no-store" };

/** A calendar day, YYYY-MM-DD; "2026-02-30" is not one. */
const isDay = (value: string | null): value is string =>
  value !== null && z.iso.date().safeParse(value).success;

const profileOf = (value: string | null): GlucoseProfile | null =>
  value === null
    ? "without_diabetes"
    : (GLUCOSE_PROFILES.find((profile) => profile === value) ?? null);

const failed = (where: string, error: unknown) => {
  console.error(where, error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: DAY_FAILED }, { status: 502, headers: NO_STORE });
};

/**
 * Signed in, a string ref, a Demo subject: then `read` runs. Anything else is
 * answered here, a subject outside the Demo audited as a scope violation.
 */
const demoRead =
  <A extends Record<string, unknown>>(
    deps: DayDeps,
    tool: string,
    args: (request: Request) => A | null,
    read: (
      ref: string,
      args: A,
      audit: (result: unknown, rowCount: number) => Promise<unknown>,
    ) => Promise<Response>,
  ) =>
  async (request: Request, context: SubjectContext) => {
    const actor = await deps.resolveActorId();
    if (!actor) {
      return NextResponse.json({ error: DAY_SIGN_IN }, { status: 401 });
    }
    const params = (await context.params) as Record<string, unknown>;
    const ref = params.subjectRef;
    if (typeof ref !== "string") {
      return NextResponse.json({ error: DAY_NOT_FOUND }, { status: 404 });
    }
    const parsed = args(request);
    if (parsed === null) {
      return NextResponse.json({ error: DAY_BAD_REQUEST }, { status: 400 });
    }
    const audit = (result: unknown, rowCount: number) =>
      deps.appendAudit({
        actor,
        sessionId: actor,
        subjectRef: ref,
        tool,
        args: parsed,
        result,
        rowCount,
      });
    try {
      if (!demoSubjectInScope(await deps.findSubject(ref))) {
        await audit(SUBJECT_SCOPE_VIOLATION, 0);
        return NextResponse.json({ error: DAY_NOT_FOUND }, { status: 404 });
      }
      return await read(ref, parsed, audit);
    } catch (error) {
      // A read that threw still happened, so it is audited before the 502.
      await audit({ error: "failed" }, 0).catch(() => undefined);
      return failed(`[digital-twin] ${tool} failed`, error);
    }
  };

/** GET /api/digital-twin/days/:subjectRef: the Demo person's days with readings, newest first. */
export const createDayListHandler = (deps: DayDeps) =>
  demoRead(
    deps,
    DAY_LIST_AUDIT_TOOL,
    () => ({ codes: DAY_CODES }),
    async (ref, _args, audit) => {
      const rows = await deps.findValues(ref, DAY_CODES);
      const days = dayList(rows);
      await audit({ days }, rows.length);
      return NextResponse.json({ days }, { headers: NO_STORE });
    },
  );

/** GET /api/digital-twin/day/:subjectRef?day=YYYY-MM-DD&profile=…: one day as a kiosk day. */
export const createDayHandler = (deps: DayDeps) =>
  demoRead(
    deps,
    DAY_AUDIT_TOOL,
    (request) => {
      const query = new URL(request.url).searchParams;
      const day = query.get("day");
      const profile = profileOf(query.get("profile"));
      return isDay(day) && profile !== null ? { codes: DAY_CODES, day, profile } : null;
    },
    async (ref, { day, profile }, audit) => {
      const rows = await deps.findValues(ref, DAY_CODES, {
        from: windowStartDate(day),
        to: windowEndDate(day),
      });
      const result = demoDay(rows, ref, day, profile);
      if (result.kind === "refused") {
        await audit({ refused: result.reason }, 0);
        return NextResponse.json(
          { error: DAY_REFUSED[result.reason] },
          { status: 422, headers: NO_STORE },
        );
      }
      await audit(result.day, rows.length);
      return NextResponse.json({ day: result.day }, { headers: NO_STORE });
    },
  );

const PERIODS: readonly Period[] = ["week", "month"];

/** GET /api/digital-twin/period/:subjectRef?period=week|month&end=YYYY-MM-DD&profile=…: the summary card. */
export const createPeriodHandler = (deps: DayDeps) =>
  demoRead(
    deps,
    PERIOD_AUDIT_TOOL,
    (request) => {
      const query = new URL(request.url).searchParams;
      const period = PERIODS.find((one) => one === query.get("period"));
      const end = query.get("end");
      const profile = profileOf(query.get("profile"));
      return period !== undefined && isDay(end) && profile !== null
        ? { codes: PERIOD_CODES, period, end, profile }
        : null;
    },
    async (ref, { period, end, profile }, audit) => {
      const rows = await deps.findValues(ref, PERIOD_CODES, periodRead(period, end));
      const result = demoPeriod(rows, period, end, profile);
      if (result.kind === "refused") {
        await audit({ refused: result.reason }, 0);
        return NextResponse.json(
          { error: PERIOD_REFUSED[result.reason] },
          { status: 422, headers: NO_STORE },
        );
      }
      await audit(result.summary, result.rowsUsed);
      return NextResponse.json({ period: result.summary }, { headers: NO_STORE });
    },
  );

/** GET /api/digital-twin/day?profile=…: the illustrative mock day; no subject is read. */
export const createMockDayHandler =
  (deps: Pick<DayDeps, "resolveActorId">) => async (request: Request) => {
    if (!(await deps.resolveActorId())) {
      return NextResponse.json({ error: DAY_SIGN_IN }, { status: 401 });
    }
    const profile = profileOf(new URL(request.url).searchParams.get("profile"));
    if (profile === null) {
      return NextResponse.json({ error: DAY_BAD_REQUEST }, { status: 400 });
    }
    return NextResponse.json({ day: mockDay(profile) }, { headers: NO_STORE });
  };
