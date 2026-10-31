import { vaultHandlers } from "@/features/vault/vault-ports";

/** Locks personal data now and clears the unlock cookie (#142). */
export const POST = vaultHandlers.lock;
