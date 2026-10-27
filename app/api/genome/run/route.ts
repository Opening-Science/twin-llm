import { postGenomeRunResponse } from "@/features/digital-twin/genome-run";

/** Blocks until the owner answers on their phone (about a minute); see docs/genome.md. */
export const maxDuration = 300;

export const POST = (): Promise<Response> => postGenomeRunResponse();
