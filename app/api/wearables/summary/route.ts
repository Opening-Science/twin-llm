import { resolveActorId } from "@/infrastructure/auth-actor";
import { getLatestOuraSummary } from "@/features/oura/connection";
import { getLatestWhoopSummary } from "@/features/whoop/connection";
import { getLatestGoogleHealthSummary } from "@/features/google-health/connection";
import { getLatestVitronicSummary } from "@/features/vitronic/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { createWearablesSummaryHandler } from "@/features/wearables/summary-handler";

/**
 * Latest wearable summaries for client-side evidence attribution after a stream.
 */
export const GET = createWearablesSummaryHandler({
  resolveActorId,
  findAppUserId,
  getLatestOuraSummary,
  getLatestWhoopSummary,
  getLatestGoogleHealthSummary,
  getLatestVitronicSummary,
});
