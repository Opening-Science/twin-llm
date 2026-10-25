import "server-only";

import type { ConnectFacts, ConnectorFacts } from "@/features/onboarding/connect-rows";
import { getGoogleHealthConnectionStatus } from "@/features/google-health/connection";
import { getOuraConnectionStatus } from "@/features/oura/connection";
import { getVitronicConnectionStatus } from "@/features/vitronic/connection";
import { getWhoopConnectionStatus } from "@/features/whoop/connection";
import {
  googleHealthEnv,
  ouraEnv,
  serverEnv,
  vitronicEnv,
  whoopEnv,
} from "@/infrastructure/env";

/**
 * What /start and its starter route know about a user's linked sources. It
 * sits in `app/` because it composes four connector features, which a feature
 * may not import. Booleans only: no token, summary or value leaves here.
 */

const notLinked = (configured: boolean): ConnectorFacts => ({
  configured,
  connected: false,
});

const configuredOnly = (): ConnectFacts => ({
  oura: notLinked(ouraEnv() !== null),
  whoop: notLinked(whoopEnv() !== null),
  googleHealth: notLinked(googleHealthEnv() !== null),
  bodyloop: notLinked(vitronicEnv() !== null),
  arkEnabled: serverEnv().GENOME_SOURCE === "ark",
});

const facts = (status: ConnectorFacts): ConnectorFacts => ({
  configured: status.configured,
  connected: status.connected,
});

export const loadConnectFacts = async (
  appUserId: string | null,
): Promise<ConnectFacts> => {
  const base = configuredOnly();
  if (!appUserId) return base;
  try {
    const [oura, whoop, googleHealth, bodyloop] = await Promise.all([
      getOuraConnectionStatus(appUserId),
      getWhoopConnectionStatus(appUserId),
      getGoogleHealthConnectionStatus(appUserId),
      getVitronicConnectionStatus(appUserId),
    ]);
    return {
      ...base,
      oura: facts(oura),
      whoop: facts(whoop),
      googleHealth: facts(googleHealth),
      bodyloop: facts(bodyloop),
    };
  } catch (error) {
    console.error(
      "[onboarding] could not read connector status",
      error instanceof Error ? error.name : "unknown",
    );
    return base;
  }
};
