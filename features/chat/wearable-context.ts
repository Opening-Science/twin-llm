import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { OuraSummary } from "@/infrastructure/oura-types";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";

export type WearableContext = {
  readonly ouraSummary: OuraSummary | null;
  readonly whoopSummary: WhoopSummary | null;
  readonly googleHealthSummary: GoogleHealthSummary | null;
  readonly vitronicSummary: VitronicSummary | null;
};

export type WearableLoaders = {
  readonly oura: (appUserId: string) => Promise<OuraSummary | null>;
  readonly whoop: (appUserId: string) => Promise<WhoopSummary | null>;
  readonly googleHealth: (appUserId: string) => Promise<GoogleHealthSummary | null>;
  readonly vitronic: (appUserId: string) => Promise<VitronicSummary | null>;
};

const NO_WEARABLES: WearableContext = {
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};

/**
 * Synthetic mode answers from the synthetic cohort only, so a personal
 * wearable snapshot is never read, let alone put in the prompt.
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
  return { ouraSummary, whoopSummary, googleHealthSummary, vitronicSummary };
};
