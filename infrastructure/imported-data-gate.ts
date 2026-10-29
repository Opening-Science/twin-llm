import "server-only";

import {
  type ImportedDataPermitDecision,
  permitImportedDataRequest,
} from "./data-mode-policy";
import { serverEnv } from "./env";
import { chatOnLoopback } from "./genome-gate";

/**
 * The imported-data policy (`permitImportedDataRequest` in
 * `data-mode-policy.ts`) applied to this server's configuration: personal
 * mode and Ollama on loopback. Read per call, never cached at module level,
 * so the chat tools ask it again before every read.
 */
export const importedDataChatPermit = (): ImportedDataPermitDecision => {
  const env = serverEnv();
  return permitImportedDataRequest({
    mode: env.DATA_MODE,
    chatProvider: env.LLM_PROVIDER,
    chatOnLoopback: chatOnLoopback(),
  });
};
