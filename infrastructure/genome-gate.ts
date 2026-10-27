import "server-only";

import {
  type GenomePermitDecision,
  permitGenomeRequest,
  permitGenomeRun,
} from "./data-mode-policy";
import { genomeEnv, serverEnv } from "./env";
import { isLoopbackUrl } from "./loopback";

/**
 * The genome policy (`data-mode-policy.ts`) applied to this server's
 * configuration. Read per call, never cached at module level.
 */

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";

/** May a chat turn read the released report and ask Carbon-X? */
export const genomeChatPermit = (): GenomePermitDecision => {
  const env = serverEnv();
  return permitGenomeRequest({
    mode: env.DATA_MODE,
    genomeSource: env.GENOME_SOURCE,
    chatProvider: env.LLM_PROVIDER,
    chatOnLoopback: isLoopbackUrl(env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL),
    carbonXOnLoopback: isLoopbackUrl(genomeEnv(env).carbonXUrl),
  });
};

/** May the dashboard run the Ark app and store its report? */
export const genomeRunPermit = (): GenomePermitDecision => {
  const env = serverEnv();
  return permitGenomeRun({ mode: env.DATA_MODE, genomeSource: env.GENOME_SOURCE });
};
