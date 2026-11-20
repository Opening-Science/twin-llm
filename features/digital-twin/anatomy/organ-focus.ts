import { type OrganSystem } from "@/packages/anatomy/systems";

export const FOCUS_ORGAN_OPACITY = 0.12;
export const FOCUS_VESSEL_OPACITY = 0.17;
export const FOCUS_HEART_OPACITY = 0.9;

export const organFocusOpacity = (
  part: Readonly<{ system: OrganSystem; group: string | null }>,
  enabled: boolean,
  mergedHeartWithoutMask: boolean,
): number => {
  if (!enabled) return 1;
  if (part.group === "heart") return FOCUS_HEART_OPACITY;
  if (part.system !== "cardiovascular") return FOCUS_ORGAN_OPACITY;
  return mergedHeartWithoutMask ? FOCUS_HEART_OPACITY : FOCUS_VESSEL_OPACITY;
};
