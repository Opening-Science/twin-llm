import "server-only";

import { getLatestGoogleHealthBundle } from "@/features/google-health/connection";
import { getLatestOuraBundle } from "@/features/oura/connection";
import { getLatestWhoopBundle } from "@/features/whoop/connection";
import { database } from "@/infrastructure/database";
import { personalReadEvent } from "@/infrastructure/personal-read-audit";
import { readPersonalDayObservations } from "@/infrastructure/personal-data-store";
import { append } from "@/packages/audit/append";
import { dayAfter, localDayBounds } from "@/packages/query-tools/replay/local-time";

import {
  connectedDayObservations,
  importedDayObservations,
} from "./your-day-personal-observations";
import { type YourDayDemo } from "./your-day-replay-demo";

const ROW_LIMIT = 5000;

export async function readPersonalReplay(
  actor: string,
  userId: string,
  day: string,
  zone: string,
) {
  const bounds = localDayBounds(day, zone);
  const start = new Date(Math.min(bounds.start.getTime(), Date.parse(day)));
  const end = new Date(Math.max(bounds.end.getTime(), Date.parse(dayAfter(day))));
  const [imported, oura, whoop, google] = await Promise.all([
    readPersonalDayObservations(userId, start, end, ROW_LIMIT + 1),
    getLatestOuraBundle(userId),
    getLatestWhoopBundle(userId),
    getLatestGoogleHealthBundle(userId),
  ]);
  if (imported.length > ROW_LIMIT) throw new Error("PersonalReplayRowLimit");
  const observations = [
    ...importedDayObservations(imported, day, zone),
    ...connectedDayObservations(oura, "Oura", day, zone),
    ...connectedDayObservations(whoop, "WHOOP", day, zone),
    ...connectedDayObservations(google, "Google Health", day, zone),
  ];
  await append(
    database(),
    personalReadEvent({ actor, purpose: "day-replay", rowCount: observations.length }),
  );
  const selection = { subject_ref: "personal", day, time_zone: zone };
  return {
    selection,
    notice: null,
    events: [],
    phases: [],
    chartData: {
      day: {
        ...selection,
        origin: "recorded",
        notice: null,
        readings: [],
        events: [],
        narrations: [],
      },
    },
    observations,
  } satisfies YourDayDemo;
}
