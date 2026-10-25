import "server-only";

import { database } from "@/infrastructure/database";

import type { ResponseToolCall } from "./document-v1";
import { querySessionAudit } from "./session-audit";

/**
 * Audit rows for one chat turn. `session_id` on the event is the host `turnId`.
 */
export const loadSessionAudit = async (
  turnId: string,
): Promise<readonly ResponseToolCall[]> => querySessionAudit(database(), turnId);
