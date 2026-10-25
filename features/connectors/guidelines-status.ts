import "server-only";

import { database } from "@/infrastructure/database";
import { GUIDELINE_SOURCE } from "@/packages/guidelines/constants";

import {
  guidelineStatusFromCounts,
  type GuidelineCorpusStatus,
  type IngestModeCount,
} from "./guideline-status-view";

/** Reads the local guideline index for the Guidelines card; the one effectful function here. */

type GuidelineStatusPorts = Readonly<{
  countByIngestMode: () => Promise<readonly IngestModeCount[]>;
  logError: (message: string, errorName: string) => void;
}>;

const defaultPorts = (): GuidelineStatusPorts => ({
  countByIngestMode: async () => {
    const rows = await database().guidelineDocument.groupBy({
      by: ["ingestMode"],
      where: { source: GUIDELINE_SOURCE },
      _count: { _all: true },
    });
    return rows.map((row) => ({ ingestMode: row.ingestMode, count: row._count._all }));
  },
  logError: console.error,
});

export const getGuidelineCorpusStatus = async (
  ports: Partial<GuidelineStatusPorts> = {},
): Promise<GuidelineCorpusStatus> => {
  const { countByIngestMode, logError } = { ...defaultPorts(), ...ports };
  try {
    return guidelineStatusFromCounts(await countByIngestMode());
  } catch (error) {
    logError(
      "[connectors] guideline status failed",
      error instanceof Error ? error.name : "unknown",
    );
    return { state: "error" };
  }
};
