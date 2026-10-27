import type { AppendInput } from "@/packages/audit/append";
import { sha256Hex } from "@/packages/audit/hash";

import {
  type GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL,
  GENOME_THREAD_REFUSED_AUDIT_TOOL,
} from "./genome-thread-policy";

/**
 * The audit row for a refused turn or export of a genome-personal thread
 * (#151): the provider (or recipient kind) and a SHA-256 of the thread id,
 * nothing else. No prompt, no answer, no genotype. Pure: the caller appends.
 */
export const genomeThreadRefusedEvent = (
  input: Readonly<{
    actor: string;
    sessionId: string;
    threadId: string;
    provider: string;
    tool?:
      | typeof GENOME_THREAD_REFUSED_AUDIT_TOOL
      | typeof GENOME_THREAD_EXPORT_REFUSED_AUDIT_TOOL;
  }>,
): AppendInput => ({
  actor: input.actor,
  sessionId: input.sessionId,
  subjectRef: null,
  tool: input.tool ?? GENOME_THREAD_REFUSED_AUDIT_TOOL,
  args: { provider: input.provider, threadSha256: sha256Hex(input.threadId) },
  result: { refused: true },
  rowCount: 0,
});
