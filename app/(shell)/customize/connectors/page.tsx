import { parseConnectorReturn } from "@/features/connectors/connector-return";
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
import {
  envLooksEmpty,
  googleHealthEnv,
  isAuthDisabled,
  ouraEnv,
  serverEnv,
  whoopEnv,
} from "@/infrastructure/env";

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

  const clerkId = await resolveActorId();
  let appUserId = clerkId ? await findAppUserId(clerkId) : null;
  if (clerkId && !appUserId && isAuthDisabled()) {
    appUserId = (await ensureAppUser(clerkId)).id;
  }

  if (!appUserId) {
    return (
      <WearablesScreen
        ouraStatus={emptyStatus(ouraEnv() !== null)}
        whoopStatus={emptyStatus(whoopEnv() !== null)}
        googleHealthStatus={emptyStatus(googleHealthEnv() !== null)}
        ouraSummary={null}
        whoopSummary={null}
        googleHealthSummary={null}
        guidelineStatus={await guidelineStatusRead}
        {...shared}
      />
    );
  }

  const [
    ouraStatus,
    whoopStatus,
    googleHealthStatus,
    ouraSummary,
    whoopSummary,
    googleHealthSummary,
    guidelineStatus,
  ] = await Promise.all([
    getOuraConnectionStatus(appUserId),
    getWhoopConnectionStatus(appUserId),
    getGoogleHealthConnectionStatus(appUserId),
    getLatestOuraSummary(appUserId),
    getLatestWhoopSummary(appUserId),
    getLatestGoogleHealthSummary(appUserId),
    guidelineStatusRead,
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
      {...shared}
    />
  );
}
