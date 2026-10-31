import "server-only";

import { database } from "./database";
import { type LiveSourceId, normaliseLiveSources } from "./live-sources";

/**
 * The live sources a person switched on (#6), on their onboarding profile.
 * Customize · Connectors, the first-run flow and chat read the same column.
 */

/**
 * The switched-on live sources, or none when they cannot be read: a failed
 * read leaves every live source off, so nothing is sent by mistake.
 */
export const loadLiveSources = async (
  userId: string,
): Promise<readonly LiveSourceId[]> => {
  try {
    const row = await database().onboardingProfile.findUnique({
      where: { userId },
      select: { liveSources: true },
    });
    return normaliseLiveSources(row?.liveSources ?? []);
  } catch (error) {
    console.error(
      "[live-sources] could not read source choices",
      error instanceof Error ? error.name : "unknown",
    );
    return [];
  }
};

export const saveLiveSources = async (
  userId: string,
  enabled: readonly LiveSourceId[],
): Promise<void> => {
  const liveSources = [...normaliseLiveSources(enabled)];
  await database().onboardingProfile.upsert({
    where: { userId },
    create: { userId, liveSources },
    update: { liveSources },
  });
};
