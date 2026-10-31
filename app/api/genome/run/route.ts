import { postGenomeRunResponse } from "@/features/digital-twin/genome-run";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/** Blocks until the owner answers on their phone (about a minute); see docs/genome.md. */
export const maxDuration = 300;

export const POST = withUnlocked((): Promise<Response> => postGenomeRunResponse());
