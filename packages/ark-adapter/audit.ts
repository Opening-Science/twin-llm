import "server-only";

import { append } from "@/packages/audit/append";
import { database } from "@/infrastructure/database";

import { arkAuditOverride } from "./hooks";

/**
 * Hashes argv and the parsed inventory/report (or error object) only.
 * row_count is always 0 — this adapter never returns dataset rows.
 */

export type ArkAuditContext = {
  readonly actor: string;
  readonly sessionId: string;
  readonly subjectRef?: string | null;
};

export type ArkAuditTool =
  "ark.status" | "ark.data.list" | "ark.data.paths" | "ark.app.run";

export const auditArkCall = async (
  ctx: ArkAuditContext,
  tool: ArkAuditTool,
  args: unknown,
  result: unknown,
): Promise<void> => {
  const override = arkAuditOverride();
  if (override) {
    await override(ctx, tool, args, result);
    return;
  }
  await append(database(), {
    actor: ctx.actor,
    sessionId: ctx.sessionId,
    subjectRef: ctx.subjectRef ?? null,
    tool,
    args,
    result,
    rowCount: 0,
  });
};
