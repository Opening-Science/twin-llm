import { personalReadEvent } from "@/infrastructure/personal-read-audit";
import { type AppendInput } from "@/packages/audit/append";
import { dayAfter, localDayBounds } from "@/packages/query-tools/replay/local-time";

import {
  connectedDayObservations,
  importedDayObservations,
  type ImportedDayObservation,
} from "./your-day-personal-observations";
import { type YourDayDemo } from "./your-day-replay-demo";

const ROW_LIMIT = 5000;

export type PersonalReplayDeps = Readonly<{
  readPersonalDayObservations: (
    userId: string,
    start: Date,
    end: Date,
    take: number,
  ) => Promise<readonly ImportedDayObservation[]>;
  getLatestOuraBundle: (userId: string) => Promise<unknown>;
  getLatestWhoopBundle: (userId: string) => Promise<unknown>;
  getLatestGoogleHealthBundle: (userId: string) => Promise<unknown>;
  append: (input: AppendInput) => Promise<unknown>;
}>;

export async function readPersonalReplay(
  deps: PersonalReplayDeps,
  actor: string,
  userId: string,
  day: string,
  zone: string,
) {
  const bounds = localDayBounds(day, zone);
  const start = new Date(Math.min(bounds.start.getTime(), Date.parse(day)));
  const end = new Date(Math.max(bounds.end.getTime(), Date.parse(dayAfter(day))));
  const [imported, oura, whoop, google] = await Promise.all([
    deps.readPersonalDayObservations(userId, start, end, ROW_LIMIT + 1),
    deps.getLatestOuraBundle(userId),
    deps.getLatestWhoopBundle(userId),
    deps.getLatestGoogleHealthBundle(userId),
  ]);
  if (imported.length > ROW_LIMIT) throw new Error("PersonalReplayRowLimit");
  const observations = [
    ...importedDayObservations(imported, day, zone),
    ...connectedDayObservations(oura, "Oura", day, zone),
    ...connectedDayObservations(whoop, "WHOOP", day, zone),
    ...connectedDayObservations(google, "Google Health", day, zone),
  ];
  await deps.append(
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
