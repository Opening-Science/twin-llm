import { NextResponse } from "next/server";

import {
  VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL,
  type VitronicSummaryAuditTool,
} from "@/features/vitronic/connection";
import { type PersonalRead } from "@/infrastructure/personal-read-audit";

/**
 * Wearables summary GET, as a factory, so the Next route file can export only
 * GET and tests can pass fakes without mock.module (those leak across files).
 *
 * The Oura, Whoop and Google Health reads write one `personal.read` row
 * (how many of the three had a summary) before the answer goes out; BodyLoop
 * writes its own row in its reader (`vitronic.wearables.summary`). When the
 * row cannot be written, nothing is sent.
 */
export type WearablesSummaryDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly getLatestOuraSummary: (userId: string) => Promise<unknown>;
  readonly getLatestWhoopSummary: (userId: string) => Promise<unknown>;
  readonly getLatestGoogleHealthSummary: (userId: string) => Promise<unknown>;
  readonly getLatestVitronicSummary: (
    userId: string,
    opts?: { readonly auditTool?: VitronicSummaryAuditTool },
  ) => Promise<unknown>;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
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

      return NextResponse.json({ oura, whoop, googleHealth, vitronic });
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
