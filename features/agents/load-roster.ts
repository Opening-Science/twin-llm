import "server-only";

import { AUTO_AGENT } from "@/infrastructure/agents";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import { type TurnSkill } from "@/infrastructure/skill-gate";
import { LITERATURE_SOURCE_PREFIX } from "@/packages/literature/constants";

import {
  type AgentUsage,
  NO_USAGE,
  rosterEntries,
  type RosterEntry,
  usageByAgent,
  usageNote,
  type UsageRow,
} from "./roster";
import { ROUTER_ITEMS } from "./router-fixtures";

/**
 * The I/O half of the roster: answers by agent in the viewer's own threads,
 * and how many literature articles the local index holds per specialty. Only
 * counts, sums and dates are read; no prompt or answer text. A failed read is
 * logged and comes back as null so the page can say it could not be read.
 */

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

/** Agent answers in the threads of `userId`, grouped by row id and column name. */
export const loadAgentUsage = async (
  userId: string | null,
): Promise<readonly UsageRow[] | null> => {
  if (userId === null) return [];
  try {
    const groups = await database().modelResponse.groupBy({
      by: ["modelId", "modelName"],
      where: { modelId: { startsWith: "agent:" }, turn: { thread: { userId } } },
      _count: { _all: true },
      _sum: { costUsd: true },
      _max: { createdAt: true },
    });
    return groups.map((group) => ({
      modelId: group.modelId,
      modelName: group.modelName,
      answers: group._count._all,
      costUsd: group._sum.costUsd === null ? 0 : Number(group._sum.costUsd),
      lastAt: group._max.createdAt?.toISOString() ?? null,
    }));
  } catch (error) {
    console.error("[agents] answer counts could not be read", errorName(error));
    return null;
  }
};

/** Documents per `literature:<specialty>` source in the local index. */
export const loadLiteratureCounts = async (): Promise<ReadonlyMap<
  string,
  number
> | null> => {
  try {
    const groups = await database().guidelineDocument.groupBy({
      by: ["source"],
      where: { source: { startsWith: LITERATURE_SOURCE_PREFIX } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.source, group._count._all]));
  } catch (error) {
    console.error("[agents] literature counts could not be read", errorName(error));
    return null;
  }
};

/** Everything the roster list and an agent's page need, read once. */
export type RosterData = Readonly<{
  entries: readonly RosterEntry[];
  autoUsage: AgentUsage;
  /** Why answer counts are missing, or null. */
  usageNote: string | null;
}>;

export const loadRoster = async (skills: readonly TurnSkill[]): Promise<RosterData> => {
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor).catch(() => null);
  const [catalog, usageRows, literatureCounts] = await Promise.all([
    fetchChatCatalog(skills).catch((error: unknown) => {
      console.error("[agents] model catalog could not be read", errorName(error));
      return null;
    }),
    loadAgentUsage(userId),
    loadLiteratureCounts(),
  ]);
  const usage = usageByAgent(usageRows ?? []);
  return {
    entries: rosterEntries({
      catalog,
      skills,
      usage,
      literatureCounts,
      routerItems: ROUTER_ITEMS,
    }),
    autoUsage: usage.get(AUTO_AGENT.id) ?? NO_USAGE,
    usageNote: usageNote(actor !== null, usageRows !== null),
  };
};
