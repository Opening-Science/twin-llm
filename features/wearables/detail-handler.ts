import type { Bundle } from "fhir/r4";
import { NextResponse } from "next/server";

import { type PersonalRead } from "@/infrastructure/personal-read-audit";

import { type WearableSource } from "./dashboard-headings";
import { isTimeZone } from "./local-clock";
import { detailRowCount, wearableDetail, type WearableDetail } from "./wearable-detail";

/**
 * Wearables detail GET, as a factory like the summary route, so tests pass
 * fakes. It reads the latest stored FHIR bundle of one source for the
 * signed-in person, works out the three detail charts on the server
 * (`wearable-detail.ts`) and sends only those. The bundle itself never
 * leaves.
 *
 * Query: `source` (oura, whoop or google-health), `start` and `end` (the
 * dashboard's window, YYYY-MM-DD) and `tz` (the viewer's IANA zone, for
 * times a source writes in UTC; UTC when missing or unknown).
 *
 * One `personal.read.wearables-detail` row (how many of the three charts
 * have data) is written before the answer goes out; when it cannot be
 * written, nothing is sent.
 */

export type WearablesDetailDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly getLatestBundle: (source: WearableSource, userId: string) => Promise<unknown>;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
};

export type WearablesDetailResponse = Readonly<{ detail: WearableDetail | null }>;

const SOURCES: readonly WearableSource[] = ["oura", "whoop", "google-health"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isSource = (value: string | null): value is WearableSource =>
  SOURCES.some((source) => source === value);

const isBundle = (value: unknown): value is Bundle =>
  typeof value === "object" &&
  value !== null &&
  Reflect.get(value, "resourceType") === "Bundle";

const badRequest = () =>
  NextResponse.json(
    { error: "Pick a source and a window to load the detail charts." },
    { status: 400 },
  );

export const createWearablesDetailHandler = (deps: WearablesDetailDeps) => {
  return async (request: Request) => {
    const params = new URL(request.url).searchParams;
    const source = params.get("source");
    const startDate = params.get("start") ?? "";
    const endDate = params.get("end") ?? "";
    if (
      !isSource(source) ||
      !ISO_DAY.test(startDate) ||
      !ISO_DAY.test(endDate) ||
      startDate > endDate
    ) {
      return badRequest();
    }
    const zone = params.get("tz") ?? "";
    const timeZone = isTimeZone(zone) ? zone : "UTC";

    const clerkId = await deps.resolveActorId();
    if (!clerkId) return NextResponse.json({ detail: null });
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) return NextResponse.json({ detail: null });

    try {
      const stored = await deps.getLatestBundle(source, appUserId);
      const detail = wearableDetail(isBundle(stored) ? stored : null, {
        source,
        startDate,
        endDate,
        timeZone,
      });
      await deps.auditPersonalRead({
        actor: clerkId,
        purpose: "wearables-detail",
        rowCount: detailRowCount(detail),
      });
      return NextResponse.json({ detail } satisfies WearablesDetailResponse);
    } catch (error) {
      console.error(
        "[wearables] detail failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not load the detail charts." },
        { status: 502 },
      );
    }
  };
};
