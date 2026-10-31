import { vaultHandlers } from "@/features/vault/vault-ports";

/** A forgotten passphrase: the recovery code sets a new passphrase and a new code (#142). */
export const POST = vaultHandlers.recover;
