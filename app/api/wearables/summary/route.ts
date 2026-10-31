import { resolveActorId } from "@/infrastructure/auth-actor";
import { getLatestOuraSummary } from "@/features/oura/connection";
import { getLatestWhoopSummary } from "@/features/whoop/connection";
import { getLatestGoogleHealthSummary } from "@/features/google-health/connection";
import { getLatestVitronicSummary } from "@/features/vitronic/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { createWearablesSummaryHandler } from "@/features/wearables/summary-handler";
import { database } from "@/infrastructure/database";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/**
 * Latest wearable summaries for client-side evidence attribution after a stream.
 */
export const GET = withUnlocked(
  createWearablesSummaryHandler({
    resolveActorId,
    findAppUserId,
    getLatestOuraSummary,
    getLatestWhoopSummary,
    getLatestGoogleHealthSummary,
    getLatestVitronicSummary,
    auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  }),
);
