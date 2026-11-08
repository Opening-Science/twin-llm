import { resolveActorId } from "@/infrastructure/auth-actor";
import { getLatestOuraBundle } from "@/features/oura/connection";
import { getLatestWhoopBundle } from "@/features/whoop/connection";
import { getLatestGoogleHealthBundle } from "@/features/google-health/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { createWearablesDetailHandler } from "@/features/wearables/detail-handler";
import { database } from "@/infrastructure/database";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";
import { withUnlocked } from "@/infrastructure/vault-runtime";

const BUNDLE_READERS = {
  oura: getLatestOuraBundle,
  whoop: getLatestWhoopBundle,
  "google-health": getLatestGoogleHealthBundle,
} as const;

/**
 * Hourly steps, last night's stages and 14 bedtimes for the wearables
 * dashboard, worked out on the server from the latest stored bundle.
 */
export const GET = withUnlocked(
  createWearablesDetailHandler({
    resolveActorId,
    findAppUserId,
    getLatestBundle: (source, userId) => BUNDLE_READERS[source](userId),
    auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  }),
);
