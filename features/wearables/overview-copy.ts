import { SOURCE_LABEL, type WearableSource } from "./dashboard-headings";

/**
 * Words of the wearables overview on the Dashboard page, in one place so
 * they are tested and `lint:claims` sees them. They say what is there and
 * how to get more, never what a number means for a person.
 */

export const OVERVIEW_LINK = {
  href: "/customize/connectors",
  label: "Link a wearable",
} as const;

export const OVERVIEW_PERIOD_LABEL = "Period";

export const OVERVIEW_SOURCE_LABEL = "Wearable";

export const overviewEmptyText = ({
  anyConfigured,
}: Readonly<{ anyConfigured: boolean }>): string =>
  anyConfigured
    ? "No wearable is linked yet. Link Oura, WHOOP or Google Health under Customize · Connectors, and its daily, weekly and monthly cards show here."
    : "No wearable is linked yet. Each one needs its app keys on this server first; Customize · Connectors lists which are missing, then links Oura, WHOOP or Google Health.";

export const overviewNoSnapshotText = (source: WearableSource): string =>
  `${SOURCE_LABEL[source]} is linked, but nothing is synced yet. Refresh it under Customize · Connectors.`;
