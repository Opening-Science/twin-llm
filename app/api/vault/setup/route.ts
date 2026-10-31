import { vaultHandlers } from "@/features/vault/vault-ports";

/** First run in personal mode: set the passphrase and get the recovery code once (#142). */
export const POST = vaultHandlers.setup;
