import { formatRelative } from "@/infrastructure/format-measure";
import type { StatusTone } from "@/infrastructure/ui-kit/status-badge";

/**
 * One status vocabulary for every connector card, so "Not configured" always
 * means the env is missing and "Not connected" always means it is ready to link.
 * Words carry the state; the tone is the badge's second cue.
 */

export type ConnectorBadge = Readonly<{
  label: "Not configured" | "Not connected" | "Connected" | "Error";
  tone: StatusTone;
}>;

export type ConnectorStatusInput = Readonly<{
  configured: boolean;
  connected: boolean;
  /** A failed link, return or refresh this visit. */
  failed: boolean;
}>;

export const connectorBadge = ({
  configured,
  connected,
  failed,
}: ConnectorStatusInput): ConnectorBadge => {
  if (!configured) return { label: "Not configured", tone: "off" };
  if (failed) return { label: "Error", tone: "warn" };
  if (connected) return { label: "Connected", tone: "ok" };
  return { label: "Not connected", tone: "neutral" };
};

/** The line under a connected card's badge. */
export const syncDetail = (
  lastSyncAt: string | null,
  now: number = Date.now(),
): string =>
  lastSyncAt ? `Synced ${formatRelative(lastSyncAt, now)}` : "Not synced yet";

/**
 * 127.0.0.1 and localhost are different hosts to a browser: the OAuth state
 * cookie set on one does not travel to a callback on the other, and every
 * proxy returns to localhost. Says so before the user links.
 */
export const loopbackHostHint = (hostname: string, port: string): string | null => {
  if (hostname !== "127.0.0.1" && hostname !== "[::1]") return null;
  const origin = `http://localhost${port ? `:${port}` : ""}`;
  return `You opened TwinLLM at ${hostname}. Sign-in returns go to localhost, so open ${origin}/connectors before linking.`;
};
