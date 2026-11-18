import type { WearableSource } from "./dashboard-headings";

/**
 * Which wearable a dashboard opens on. Connectors and the Dashboard page
 * both ask here, so they open on the same source. Pure.
 */

export const WEARABLE_ORDER: readonly WearableSource[] = [
  "oura",
  "whoop",
  "google-health",
];

export type LinkedFlags = Readonly<Record<WearableSource, boolean>>;

/** The linked wearables, Oura before WHOOP before Google Health. */
export const linkedSources = (linked: LinkedFlags): readonly WearableSource[] =>
  WEARABLE_ORDER.filter((source) => linked[source]);

/** The asked-for source when it is linked, else the first linked one, else Oura. */
export const firstLinkedSource = (
  linked: LinkedFlags,
  preferred: WearableSource,
): WearableSource =>
  linked[preferred] ? preferred : (linkedSources(linked)[0] ?? "oura");
