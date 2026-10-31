import { vaultHandlers } from "@/features/vault/vault-ports";

/** Unlocks personal data with the passphrase and sets the unlock cookie (#142). */
export const POST = vaultHandlers.unlock;
