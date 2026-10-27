import type { StatusTone } from "@/infrastructure/ui-kit/status-badge";

/**
 * Client-safe Ark status shapes. Shared by the Connectors card and the
 * Digital Twin inventory so the route payload has one type on both sides.
 */

export type ArkSlotView = {
  readonly slot: string;
  readonly name: string;
  readonly state: "empty" | "filled";
  readonly build: string | null;
  readonly version: string | null;
};

export type ArkStatusDisabled = {
  readonly enabled: false;
};

export type ArkStatusOk = {
  readonly enabled: true;
  readonly state: "ok";
  readonly serial: string;
  readonly hardware: {
    readonly model: string;
    readonly version: string;
    readonly revision: string;
  };
  readonly firmware: string;
  readonly trust: string;
  readonly paired: boolean | null;
  readonly unlocked: boolean | null;
  readonly slots: readonly ArkSlotView[];
  readonly pathCount: number;
  readonly allGenome: boolean;
};

export type ArkStatusUnavailable = {
  readonly enabled: true;
  readonly state:
    | "locked"
    | "unpaired"
    | "busy"
    | "awaiting_approval"
    | "refused"
    | "undelivered"
    | "outdated"
    | "rejected"
    | "app_failed"
    | "error";
  readonly error: { readonly code: string };
};

/** Ark CLI 0.5.0 refuses firmware older than 0.13.1; the owner updates it, never the app. */
export const ARK_OUTDATED_NOTICE = "Ark firmware too old: run `ark firmware update`";

export type ArkStatusPayload = ArkStatusDisabled | ArkStatusOk | ArkStatusUnavailable;

export const ARK_STATE_LABEL: Readonly<
  Record<ArkStatusOk["state"] | ArkStatusUnavailable["state"], string>
> = {
  ok: "Ready",
  locked: "Locked",
  unpaired: "Not paired",
  busy: "Busy",
  awaiting_approval: "Waiting for approval",
  refused: "Declined",
  undelivered: "Phone not reached",
  outdated: "Firmware too old",
  rejected: "Refused by the Ark",
  app_failed: "App failed",
  error: "Unavailable",
};

// Words carry the state; the tone is the second cue on the badge. Only a
// refusal or a failure is a warning: locked, unpaired or busy are normal.
export const ARK_STATE_TONE: Readonly<
  Record<ArkStatusOk["state"] | ArkStatusUnavailable["state"], StatusTone>
> = {
  ok: "ok",
  locked: "neutral",
  unpaired: "neutral",
  busy: "neutral",
  awaiting_approval: "neutral",
  refused: "warn",
  undelivered: "warn",
  outdated: "warn",
  rejected: "warn",
  app_failed: "warn",
  error: "warn",
};

export const isArkStatusPayload = (value: unknown): value is ArkStatusPayload =>
  typeof value === "object" && value !== null && "enabled" in value;
