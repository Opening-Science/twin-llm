import {
  VENDOR_LOGOS,
  type DeviceRow,
  type VendorLogo,
} from "@/infrastructure/charts/kit";

/**
 * The wearables as C15 device rows: each source's connection and sync state
 * as one status word and a detail line in plain words. Pure, so the mapping
 * is tested without a screen.
 */

export type DeviceSource = "oura" | "whoop" | "google-health";

export type DeviceRowInput = Readonly<{
  source: DeviceSource;
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  /** A failed link, return or refresh this visit. */
  failed: boolean;
  /** Shown while the source is not linked, e.g. what it is for. */
  idleDetail?: string | null;
}>;

/** A link with no sync for longer than this is stale. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The name on the row, as each vendor writes it. */
export const DEVICE_NAME: Readonly<Record<DeviceSource, string>> = {
  oura: "Oura",
  whoop: "WHOOP",
  "google-health": "Google Health",
};

/**
 * Oura has no logo yet (its wordmark is not in the repository), so its row
 * keeps an empty tile.
 */
const LOGO: Readonly<Record<DeviceSource, VendorLogo | undefined>> = {
  oura: undefined,
  whoop: VENDOR_LOGOS.whoop,
  "google-health": VENDOR_LOGOS.googleHealth,
};

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** "synced 4 minutes ago", "synced 2 hours ago", "synced 3 days ago". */
export const syncedPhrase = (lastSyncAt: string | null, now: number): string => {
  const then = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  if (Number.isNaN(then)) return "not synced yet";
  const age = Math.max(0, now - then);
  if (age < MINUTE) return "synced just now";
  if (age < HOUR) return `synced ${count(Math.floor(age / MINUTE), "minute")}`;
  if (age < 2 * DAY) return `synced ${count(Math.floor(age / HOUR), "hour")}`;
  return `synced ${count(Math.floor(age / DAY), "day")}`;
};

export type DeviceStatus = NonNullable<DeviceRow["status"]>;

/** One word per state; the tone is the second cue, never the only one. */
export const deviceStatus = (
  { configured, connected, lastSyncAt, failed }: DeviceRowInput,
  now: number,
): DeviceStatus => {
  if (!configured) return { word: "Not set up", tone: "neutral" };
  if (failed) return { word: "Error", tone: "warn" };
  if (!connected) return { word: "Not linked", tone: "neutral" };
  const then = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  if (!Number.isNaN(then) && now - then > STALE_AFTER_MS) {
    return { word: "Stale", tone: "warn" };
  }
  return { word: "Linked", tone: "ok" };
};

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The line under the name. A linked WHOOP row reads "Data by WHOOP ·
 * synced …" (the kit adds the credit from the logo); a linked Google Health
 * row reads "Connected to Google Health · synced …", as Google asks.
 */
const detailFor = (input: DeviceRowInput, now: number): string | undefined => {
  if (!input.connected || !input.configured) return input.idleDetail ?? undefined;
  const synced = syncedPhrase(input.lastSyncAt, now);
  if (input.source === "google-health") return `Connected to Google Health · ${synced}`;
  return input.source === "whoop" ? synced : capitalise(synced);
};

/**
 * The vendor's logo, with its credit ("Data by") only while its data is
 * shown: an unlinked WHOOP row has no WHOOP data to credit.
 */
const logoFor = (input: DeviceRowInput): VendorLogo | undefined => {
  const logo = LOGO[input.source];
  if (!logo || (input.connected && input.configured)) return logo;
  const { attribution: _credit, ...withoutCredit } = logo;
  return withoutCredit;
};

export const deviceRow = (input: DeviceRowInput, now: number = Date.now()): DeviceRow => {
  const detail = detailFor(input, now);
  const logo = logoFor(input);
  return {
    name: DEVICE_NAME[input.source],
    status: deviceStatus(input, now),
    ...(detail ? { detail } : {}),
    ...(logo ? { logo } : {}),
  };
};
