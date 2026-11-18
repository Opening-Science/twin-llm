import { NextResponse } from "next/server";

import {
  VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL,
  type VitronicSummaryAuditTool,
} from "@/features/vitronic/connection";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import { judgeByEvidence } from "@/infrastructure/open-twin-adapters/aggregate";
import type { OuraSummary } from "@/infrastructure/oura-types";
import { type PersonalRead } from "@/infrastructure/personal-read-audit";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import {
  summarySources,
  wearableSourcesEvent,
} from "@/infrastructure/wearable-source-audit";
import { resolveWearableSources } from "@/infrastructure/wearable-source-resolve";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import type { AppendInput } from "@/packages/audit/append";

/**
 * Wearables summary GET, as a factory, so the Next route file can export only
 * GET and tests can pass fakes without mock.module (those leak across files).
 *
 * The Oura, Whoop and Google Health reads write one `personal.read` row
 * (how many of the three had a summary) before the answer goes out; BodyLoop
 * writes its own row in its reader (`vitronic.wearables.summary`). The
 * summaries then go through the source rules (#464), as the chat's do, and a
 * `wearable.sources.*` row records which source each overlapping measure came
 * from. When a row cannot be written, nothing is sent.
 */
export type WearablesSummaryDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly getLatestOuraSummary: (userId: string) => Promise<OuraSummary | null>;
  readonly getLatestWhoopSummary: (userId: string) => Promise<WhoopSummary | null>;
  readonly getLatestGoogleHealthSummary: (
    userId: string,
  ) => Promise<GoogleHealthSummary | null>;
  readonly getLatestVitronicSummary: (
    userId: string,
    opts?: { readonly auditTool?: VitronicSummaryAuditTool },
  ) => Promise<VitronicSummary | null>;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
  readonly appendAudit: (input: AppendInput) => Promise<unknown>;
};

export const createWearablesSummaryHandler = (deps: WearablesSummaryDeps) => {
  return async () => {
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json({
        oura: null,
        whoop: null,
        googleHealth: null,
        vitronic: null,
      });
    }

    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({
        oura: null,
        whoop: null,
        googleHealth: null,
        vitronic: null,
      });
    }

    try {
      const [oura, whoop, googleHealth, vitronic] = await Promise.all([
        deps.getLatestOuraSummary(appUserId),
        deps.getLatestWhoopSummary(appUserId),
        deps.getLatestGoogleHealthSummary(appUserId),
        deps.getLatestVitronicSummary(appUserId, {
          auditTool: VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL,
        }),
      ]);
      await deps.auditPersonalRead({
        actor: clerkId,
        purpose: "wearables-summary",
        rowCount: [oura, whoop, googleHealth].filter((summary) => summary != null).length,
      });
      const { summaries, decisions } = resolveWearableSources(
        { oura, whoop, googleHealth, vitronic },
        judgeByEvidence,
      );
      const sources = wearableSourcesEvent({
        actor: clerkId,
        sessionId: clerkId,
        sources: summarySources(summaries),
        decisions,
      });
      if (sources !== null) await deps.appendAudit(sources);

      return NextResponse.json(summaries);
    } catch (error) {
      console.error(
        "[wearables] summary failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not load wearable summaries." },
        { status: 502 },
      );
    }
  };
};
