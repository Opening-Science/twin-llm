import { parseConnectorReturn } from "@/features/connectors/connector-return";
import { readConnectorSummaries } from "@/features/connectors/connector-summaries";
import { connectorSetupViews } from "@/features/connectors/connector-setup";
import { getGuidelineCorpusStatus } from "@/features/connectors/guidelines-status";
import { WearablesScreen } from "@/features/wearables/wearables-screen";
import {
  getLatestOuraSummary,
  getOuraConnectionStatus,
} from "@/features/oura/connection";
import {
  getLatestWhoopSummary,
  getWhoopConnectionStatus,
} from "@/features/whoop/connection";
import {
  getLatestGoogleHealthSummary,
  getGoogleHealthConnectionStatus,
} from "@/features/google-health/connection";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser, findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import {
  envLooksEmpty,
  googleHealthEnv,
  isAuthDisabled,
  isLocalOnly,
  ouraEnv,
  serverEnv,
  whoopEnv,
} from "@/infrastructure/env";
import { loadLiveSources } from "@/infrastructure/live-source-store";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";
import { lockedScreen } from "@/features/vault/page-gate";

/** Summaries for this page view, audited in personal mode (#223). */
const summaryDeps = {
  isPersonalMode: () => serverEnv().DATA_MODE === "personal",
  getLatestOuraSummary,
  getLatestWhoopSummary,
  getLatestGoogleHealthSummary,
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
};

const emptyStatus = (configured: boolean) => ({
  configured,
  connected: false,
  linkedAt: null,
  lastSyncAt: null,
});

export default async function ConnectorsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const locked = await lockedScreen();
  if (locked) return locked;
  const params = await searchParams;
  const rawSource = params.source;
  const initialSource =
    rawSource === "whoop"
      ? "whoop"
      : rawSource === "google-health"
        ? "google-health"
        : "oura";

  // Names and booleans only: no env value leaves the server.
  const setups = connectorSetupViews(serverEnv(), envLooksEmpty);
  const returnNotice = parseConnectorReturn(params, {
    dev: process.env.NODE_ENV !== "production",
  });
  // Starts now and joins the other reads below; it never rejects (errors map to "error").
  const guidelineStatusRead = getGuidelineCorpusStatus();
  const shared = { initialSource, setups, returnNotice } as const;
  const localOnly = isLocalOnly();

  const clerkId = await resolveActorId();
  let appUserId = clerkId ? await findAppUserId(clerkId) : null;
  if (clerkId && !appUserId && isAuthDisabled()) {
    appUserId = (await ensureAppUser(clerkId)).id;
  }

  if (!clerkId || !appUserId) {
    return (
      <WearablesScreen
        ouraStatus={emptyStatus(ouraEnv() !== null)}
        whoopStatus={emptyStatus(whoopEnv() !== null)}
        googleHealthStatus={emptyStatus(googleHealthEnv() !== null)}
        ouraSummary={null}
        whoopSummary={null}
        googleHealthSummary={null}
        guidelineStatus={await guidelineStatusRead}
        liveSources={{ enabled: [], localOnly, canSave: false }}
        {...shared}
      />
    );
  }

  const [
    ouraStatus,
    whoopStatus,
    googleHealthStatus,
    { ouraSummary, whoopSummary, googleHealthSummary },
    guidelineStatus,
    liveEnabled,
  ] = await Promise.all([
    getOuraConnectionStatus(appUserId),
    getWhoopConnectionStatus(appUserId),
    getGoogleHealthConnectionStatus(appUserId),
    readConnectorSummaries(summaryDeps, clerkId, appUserId),
    guidelineStatusRead,
    loadLiveSources(appUserId),
  ]);

  return (
    <WearablesScreen
      ouraStatus={ouraStatus}
      whoopStatus={whoopStatus}
      googleHealthStatus={googleHealthStatus}
      ouraSummary={ouraSummary}
      whoopSummary={whoopSummary}
      googleHealthSummary={googleHealthSummary}
      guidelineStatus={guidelineStatus}
      liveSources={{ enabled: liveEnabled, localOnly, canSave: true }}
      {...shared}
    />
  );
}
