import { cookies } from "next/headers";

import { YourDayLayout } from "@/features/digital-twin/day/your-day-layout";
import { readPersonalReplay } from "@/features/digital-twin/day/data/your-day-personal";
import { yourDayReplayFixtures } from "@/features/digital-twin/day/data/your-day-replay-demo";
import { YourDayViewer } from "@/features/digital-twin/day/your-day-viewer";
import { YourDayViewerZone } from "@/features/digital-twin/day/your-day-viewer-zone";
import {
  YOUR_DAY_ZONE_COOKIE,
  zoneFromCookie,
} from "@/features/digital-twin/day/your-day-zone";
import { DigitalTwinFrame } from "@/features/digital-twin/digital-twin-frame";
import { YOUR_DAY_COPY } from "@/features/digital-twin/twin-page-copy";
import { lockedScreen } from "@/features/vault/page-gate";
import { findAppUserId } from "@/infrastructure/current-user";
import { dataMode } from "@/infrastructure/data-mode";
import { vaultDecisionForPage } from "@/infrastructure/vault-runtime";
import {
  DEMO_PERSON_A,
  DEMO_REFERENCE_DAY,
  DEMO_TIME_ZONE,
} from "@/packages/query-tools/replay/demo-days";
import { isCalendarDay, localClock } from "@/packages/query-tools/replay/local-time";

const COPY = YOUR_DAY_COPY.personal;

type Query = Readonly<{ date?: string | string[] }>;

async function PersonalReplay({ date }: Query) {
  const gate = await vaultDecisionForPage();
  if (!gate.ok) return (await lockedScreen()) ?? <p>{COPY.signIn}</p>;
  if (!gate.actorId || !gate.keys) return <p>{COPY.unlock}</p>;
  const userId = await findAppUserId(gate.actorId);
  if (!userId) return <p>{COPY.noAccount}</p>;
  // The zone comes from a first-party cookie, never the URL (your-day-zone.ts).
  const stored = (await cookies()).get(YOUR_DAY_ZONE_COOKIE)?.value;
  const timeZone = zoneFromCookie(stored);
  if (timeZone === null) return <YourDayViewerZone fallback={stored !== undefined} />;
  if (date !== undefined && (typeof date !== "string" || !isCalendarDay(date))) {
    return <p role="alert">{COPY.invalidQuery}</p>;
  }
  const day = typeof date === "string" ? date : localClock(new Date(), timeZone).day;
  const replay = await readPersonalReplay(gate.actorId, userId, day, timeZone).catch(
    (error: unknown) => {
      console.error(
        "[digital-twin] personal day replay read failed",
        error instanceof Error ? error.name : "unknown",
      );
      return null;
    },
  );
  if (!replay) return <p role="alert">{COPY.loadFailed}</p>;
  return (
    <YourDayLayout
      initialDate={day}
      demoDays={[replay]}
      demoIdentity={replay.selection}
      personal
    >
      <div className="p-4 text-sm">
        <p>{COPY.heading(timeZone)}</p>
        <p className="text-muted-foreground mt-2">{COPY.sources}</p>
      </div>
    </YourDayLayout>
  );
}

export default async function YourDayPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Query> }>) {
  const query = await searchParams;
  return (
    <DigitalTwinFrame extraWide>
      {dataMode() === "personal" ? (
        <PersonalReplay date={query.date} />
      ) : (
        <YourDayLayout
          initialDate={DEMO_REFERENCE_DAY}
          demoDays={yourDayReplayFixtures()}
          demoIdentity={{ subject_ref: DEMO_PERSON_A, time_zone: DEMO_TIME_ZONE }}
        >
          <YourDayViewer />
        </YourDayLayout>
      )}
    </DigitalTwinFrame>
  );
}
