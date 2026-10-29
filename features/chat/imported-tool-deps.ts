import "server-only";

import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { importedDataChatPermit } from "@/infrastructure/imported-data-gate";
import { importedDataReads } from "@/infrastructure/personal-data-store";
import { append } from "@/packages/audit/append";
import type { ImportedToolDeps } from "@/packages/query-tools/imported-tools";
import type { SessionScope } from "@/packages/query-tools/scope";

/**
 * The real ports behind the imported-data tools, or undefined when this turn
 * may not have them: synthetic mode, or a chat model not on this machine. The
 * tools ask the same policy again before every call. Reads are bound to the
 * turn's own actor, whose user row is looked up once.
 */
export const importedToolDepsFor = (
  scope: SessionScope,
): ImportedToolDeps | undefined => {
  if (scope.mode !== "personal" || !importedDataChatPermit().ok) return undefined;
  const user = { lookup: null as Promise<string | null> | null };
  const userId = (): Promise<string | null> => {
    user.lookup ??= findAppUserId(scope.actor);
    return user.lookup;
  };
  return {
    scope,
    permit: importedDataChatPermit,
    ports: {
      ...importedDataReads(userId),
      appendAudit: (input) => append(database(), input),
    },
  };
};
