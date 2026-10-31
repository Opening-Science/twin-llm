import { MIN_PASSPHRASE_LENGTH } from "@/infrastructure/vault-crypto";

import { VAULT_COPY } from "./vault-copy";

/**
 * The unlock screen's steps and checks, without React (#142). The server
 * checks the passphrase again; these only save a round trip.
 */

export type VaultStep = "setup" | "unlock" | "recover" | "code";

/** Which route a step's form posts to. */
export const VAULT_ROUTE: Readonly<Record<Exclude<VaultStep, "code">, string>> = {
  setup: "/api/vault/setup",
  unlock: "/api/vault/unlock",
  recover: "/api/vault/recover",
};

/** The step to show first for a refusal code from the gate. */
export const firstStep = (code: string): VaultStep =>
  code === "PERSONAL_DATA_NOT_SET_UP" ? "setup" : "unlock";

/** A plain sentence when a new passphrase and its repeat cannot be sent, else null. */
export const newPassphraseProblem = (
  passphrase: string,
  repeat: string,
): string | null => {
  if ([...passphrase.normalize("NFC")].length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  return passphrase === repeat ? null : VAULT_COPY.mismatch;
};

/** After a 200: the new recovery code to show once, or null to reload the page. */
export const recoveryCodeIn = (body: unknown): string | null => {
  const code =
    typeof body === "object" && body !== null ? Reflect.get(body, "recoveryCode") : null;
  return typeof code === "string" && code.length > 0 ? code : null;
};

/** The sentence to show for a refusal, from the route's `{ error }`, or a fallback. */
export const errorFrom = (body: unknown): string => {
  const error =
    typeof body === "object" && body !== null ? Reflect.get(body, "error") : null;
  return typeof error === "string" && error.length > 0 ? error : VAULT_COPY.failed;
};
