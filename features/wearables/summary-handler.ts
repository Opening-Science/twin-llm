import { NextResponse } from "next/server";

import {
  VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL,
  type VitronicSummaryAuditTool,
} from "@/features/vitronic/connection";

/**
 * Wearables summary GET, as a factory, so the Next route file can export only
 * GET and tests can pass fakes without mock.module (those leak across files).
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
