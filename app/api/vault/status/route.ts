import { vaultHandlers } from "@/features/vault/vault-ports";

/** Whether this person's data is locked, unlocked or not set up yet (#142). */
export const GET = vaultHandlers.status;
