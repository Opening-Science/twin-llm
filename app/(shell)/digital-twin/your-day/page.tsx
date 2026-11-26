import { YourDayLayout } from "@/features/digital-twin/day/your-day-layout";
import { readPersonalReplay } from "@/features/digital-twin/day/your-day-personal";
import { yourDayReplayFixtures } from "@/features/digital-twin/day/your-day-replay-demo";
import { YourDayViewer } from "@/features/digital-twin/day/your-day-viewer";
import { DigitalTwinFrame } from "@/features/digital-twin/digital-twin-frame";
import { lockedScreen } from "@/features/vault/page-gate";
import { findAppUserId } from "@/infrastructure/current-user";
import { dataMode } from "@/infrastructure/data-mode";
import { vaultDecisionForPage } from "@/infrastructure/vault-runtime";
import {
  DEMO_PERSON_A,
  DEMO_REFERENCE_DAY,
  DEMO_TIME_ZONE,
} from "@/packages/query-tools/replay/demo-days";
import {
  isCalendarDay,
  isTimeZone,
  localClock,
} from "@/packages/query-tools/replay/local-time";

type Query = Readonly<{ date?: string | string[]; zone?: string | string[] }>;

async function PersonalReplay({ date, zone }: Query) {
  const gate = await vaultDecisionForPage();
  if (!gate.ok) return (await lockedScreen()) ?? <p>Sign in to replay your data.</p>;
  if (!gate.actorId || !gate.keys) return <p>Unlock your vault to replay your data.</p>;
  const userId = await findAppUserId(gate.actorId);
  if (!userId) return <p>No personal data account was found.</p>;
  if (
    (zone !== undefined && (typeof zone !== "string" || !isTimeZone(zone))) ||
    (date !== undefined && (typeof date !== "string" || !isCalendarDay(date)))
  ) {
    return <p role="alert">Choose a valid date and time zone to replay your data.</p>;
  }
  const timeZone = typeof zone === "string" ? zone : "UTC";
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
  if (!replay)
    return (
      <p role="alert">
        Could not load your replay data. Try another date or reload the page.
      </p>
    );
  return (
    <YourDayLayout
      initialDate={day}
      demoDays={[replay]}
      demoIdentity={replay.selection}
      personal
    >
      <div className="p-4 text-sm">
        <p>My Data · {timeZone}</p>
        <p className="text-muted-foreground mt-2">
          Imported observations and the latest synced wearable records.
        </p>
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
        <PersonalReplay date={query.date} zone={query.zone} />
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
