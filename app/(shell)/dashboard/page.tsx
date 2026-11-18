import { readConnectorSummaries } from "@/features/connectors/connector-summaries";
import { connectorSetupViews } from "@/features/connectors/connector-setup";
import { DashboardScreen } from "@/features/dashboard/dashboard-screen";
import { DayGlanceCard } from "@/features/digital-twin/day/day-glance-card";
import {
  getGoogleHealthConnectionStatus,
  getLatestGoogleHealthSummary,
} from "@/features/google-health/connection";
import {
  getLatestOuraSummary,
  getOuraConnectionStatus,
} from "@/features/oura/connection";
import { lockedScreen } from "@/features/vault/page-gate";
import { WearablesOverview } from "@/features/wearables/wearables-overview";
import {
  getLatestWhoopSummary,
  getWhoopConnectionStatus,
} from "@/features/whoop/connection";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser, findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import {
  envLooksEmpty,
  googleHealthEnv,
  isAuthDisabled,
  ouraEnv,
  serverEnv,
  whoopEnv,
} from "@/infrastructure/env";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";

/** Summaries for this page view, audited in personal mode (#223). */
const summaryDeps = {
  isPersonalMode: () => serverEnv().DATA_MODE === "personal",
  getLatestOuraSummary,
  getLatestWhoopSummary,
  getLatestGoogleHealthSummary,
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
};

const notLinked = (configured: boolean) => ({
  configured,
  connected: false,
  linkedAt: null,
  lastSyncAt: null,
});

/** The wearables section: what Connectors reads, under the Dashboard's own audit row. */
const loadWearables = async (clerkId: string | null, appUserId: string | null) => {
  const setups = connectorSetupViews(serverEnv(), envLooksEmpty);
  const wearableSetups = {
    oura: setups.oura,
    whoop: setups.whoop,
    "google-health": setups["google-health"],
  };
  if (!clerkId || !appUserId) {
    return {
      statuses: {
        oura: notLinked(ouraEnv() !== null),
        whoop: notLinked(whoopEnv() !== null),
        "google-health": notLinked(googleHealthEnv() !== null),
      },
      summaries: { oura: null, whoop: null, "google-health": null },
      setups: wearableSetups,
    };
  }
  const [oura, whoop, googleHealth, summaries] = await Promise.all([
    getOuraConnectionStatus(appUserId),
    getWhoopConnectionStatus(appUserId),
    getGoogleHealthConnectionStatus(appUserId),
    readConnectorSummaries(summaryDeps, clerkId, appUserId, "dashboard-page"),
  ]);
  return {
    statuses: { oura, whoop, "google-health": googleHealth },
    summaries: {
      oura: summaries.ouraSummary,
      whoop: summaries.whoopSummary,
      "google-health": summaries.googleHealthSummary,
    },
    setups: wearableSetups,
  };
};

/**
 * The dashboard reads the person's own wearables and threads, so while the
 * data is locked (#142) it shows the unlock screen like every other personal
 * page.
 */
export default async function DashboardPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  const clerkId = await resolveActorId();
  let appUserId = clerkId ? await findAppUserId(clerkId) : null;
  if (clerkId && !appUserId && isAuthDisabled()) {
    appUserId = (await ensureAppUser(clerkId)).id;
  }
  const wearables = await loadWearables(clerkId, appUserId);
  return (
    <DashboardScreen
      slots={{
        wearables: <WearablesOverview {...wearables} />,
        twin: <DayGlanceCard />,
      }}
    />
  );
}
