import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { OuraSummary } from "@/infrastructure/oura-types";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import { judgeByEvidence } from "@/infrastructure/open-twin-adapters/aggregate";
import { resolveWearableSources } from "@/infrastructure/wearable-source-resolve";
import type { SourceDecision } from "@/infrastructure/wearable-source-rules";

export type WearableContext = {
  readonly ouraSummary: OuraSummary | null;
  readonly whoopSummary: WhoopSummary | null;
  readonly googleHealthSummary: GoogleHealthSummary | null;
  readonly vitronicSummary: VitronicSummary | null;
  /**
   * How overlapping readings were resolved (#464), for the turn's audit row.
   * The summaries above are already resolved; left out, there were none.
   */
  readonly sourceDecisions?: readonly SourceDecision[];
};

export type WearableLoaders = {
  readonly oura: (appUserId: string) => Promise<OuraSummary | null>;
  readonly whoop: (appUserId: string) => Promise<WhoopSummary | null>;
  readonly googleHealth: (appUserId: string) => Promise<GoogleHealthSummary | null>;
  readonly vitronic: (appUserId: string) => Promise<VitronicSummary | null>;
};

export const NO_WEARABLES: WearableContext = {
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};

/**
 * Synthetic mode answers from the synthetic cohort only, so a personal
 * wearable snapshot is never read, let alone put in the prompt. In personal
 * mode the snapshots go through the source rules (#464) before anything
 * reads them: where sources overlap, only the reading used is left.
 */
export const loadWearableContext = async (
  mode: DataMode,
  appUserId: string,
  loaders: WearableLoaders,
): Promise<WearableContext> => {
  if (mode === "synthetic") return NO_WEARABLES;

  const [ouraSummary, whoopSummary, googleHealthSummary, vitronicSummary] =
    await Promise.all([
      loaders.oura(appUserId),
      loaders.whoop(appUserId),
      loaders.googleHealth(appUserId),
      loaders.vitronic(appUserId),
    ]);
  const { summaries, decisions } = resolveWearableSources(
    {
      oura: ouraSummary,
      whoop: whoopSummary,
      googleHealth: googleHealthSummary,
      vitronic: vitronicSummary,
    },
    judgeByEvidence,
  );
  return {
    ouraSummary: summaries.oura,
    whoopSummary: summaries.whoop,
    googleHealthSummary: summaries.googleHealth,
    vitronicSummary: summaries.vitronic,
    sourceDecisions: decisions,
  };
};
