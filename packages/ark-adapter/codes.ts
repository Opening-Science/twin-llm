/**
 * Maps Ark CLI exit classes and error[code] strings onto the adapter
 * state union. Never match error[ark] remote numbers.
 */

export type ArkError = {
  readonly code: string;
  readonly message: string;
  readonly remoteCode?: string;
  readonly remoteMessage?: string;
  readonly issues?: readonly string[];
};

export type ArkOk<T> = {
  readonly status: "ok";
  readonly data: T;
};

export const ARK_FAILURE_STATUSES = [
  "locked",
  "unpaired",
  "busy",
  "awaiting_approval",
  "refused",
  "undelivered",
  "outdated",
  "rejected",
  "app_failed",
  "error",
] as const;

export type ArkFailureStatus = (typeof ARK_FAILURE_STATUSES)[number];

export type ArkFailure = {
  readonly status: ArkFailureStatus;
  readonly error: ArkError;
};

export type ArkResult<T> = ArkOk<T> | ArkFailure;

export const GENOME_SOURCE_DISABLED: ArkError = {
  code: "genome-source-disabled",
  message: "GENOME_SOURCE is not ark; refusing to spawn the ark CLI",
};

export const UNLOCK_FORBIDDEN: ArkError = {
  code: "unlock-forbidden",
  message: "TwinLLM never passes --unlock to the ark CLI",
};

export const toArkError = (
  code: string,
  message: string,
  remoteCode?: string,
  remoteMessage?: string,
  issues?: readonly string[],
): ArkError => {
  const error: ArkError = { code, message };
  const withRemote =
    remoteCode !== undefined
      ? remoteMessage !== undefined
        ? { ...error, remoteCode, remoteMessage }
        : { ...error, remoteCode }
      : remoteMessage !== undefined
        ? { ...error, remoteMessage }
        : error;
  return issues !== undefined ? { ...withRemote, issues } : withRemote;
};

export const errorFromObject = (value: {
  readonly code: string;
  readonly message: string;
  readonly remote?: {
    readonly code?: string | number;
    readonly message?: string;
  } | null;
  readonly remote_code?: string;
  readonly remote_message?: string;
}): ArkError => {
  const remoteCode =
    value.remote?.code !== undefined ? String(value.remote.code) : value.remote_code;
  const remoteMessage = value.remote?.message ?? value.remote_message;
  return toArkError(value.code, value.message, remoteCode, remoteMessage);
};

const EXIT_FALLBACK: Readonly<Record<number, { code: string; message: string }>> = {
  1: { code: "local-input", message: "ark CLI local input or confirmation failed" },
  2: { code: "usage", message: "ark CLI usage error" },
  3: { code: "device-access", message: "ark CLI device access failed" },
  4: { code: "cloud", message: "ark CLI cloud request failed" },
  5: { code: "ark-state", message: "ark CLI Ark state or refusal" },
  6: { code: "approval", message: "ark CLI approval failed" },
  7: { code: "timeout", message: "ark CLI machine wait exceeded --timeout" },
  8: { code: "app-failed", message: "ark app reported failure" },
  130: { code: "interrupted", message: "ark CLI interrupted" },
  143: { code: "terminated", message: "ark CLI terminated" },
};

export const errorFromExitCode = (exitCode: number): ArkError => {
  const fallback = EXIT_FALLBACK[exitCode];
  if (fallback) return fallback;
  return {
    code: "unknown-exit",
    message: `ark CLI exited with code ${exitCode}`,
  };
};

/**
 * CLI 0.5.0 codes by exit class: 4 approval-undelivered, 5 firmware-outdated
 * and the Ark's own refusal (`ark`, e.g. a grant it will not mount), 6
 * approval-denied / approval-timeout (the run or the report review), 8
 * app-failed. Everything else stays `error`.
 */
export const mapArkFailure = (error: ArkError): ArkFailure => {
  switch (error.code) {
    case "locked":
      return { status: "locked", error };
    case "not-paired":
      return { status: "unpaired", error };
    case "device-busy":
      return { status: "busy", error };
    case "approval-denied":
      return { status: "refused", error };
    case "approval-timeout":
      return { status: "awaiting_approval", error };
    case "approval-undelivered":
      return { status: "undelivered", error };
    case "firmware-outdated":
      return { status: "outdated", error };
    case "ark":
      return { status: "rejected", error };
    case "app-failed":
      return { status: "app_failed", error };
    default:
      return { status: "error", error };
  }
};

export const isArkOk = <T>(result: ArkResult<T>): result is ArkOk<T> =>
  result.status === "ok";
