import "server-only";

import { unstable_rethrow } from "next/navigation";

import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import { readableTitle } from "@/infrastructure/readable-title";
import { openThreadTitle } from "@/infrastructure/thread-fields";

import { groupThreads, type ThreadGroup } from "./thread-list";

/**
 * One person's threads for the sidebar, newest activity first, with how many
 * distinct models have answered in each. Only ids are read from the answers,
 * never their text.
 */
export const listThreadHistory = async (
  userId: string,
  now: Date = new Date(),
): Promise<ThreadGroup[]> => {
  const threads = await database().thread.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      turns: { select: { responses: { select: { modelId: true } } } },
    },
  });

  const cipher = await cipherForUser(userId);
  return groupThreads(
    threads.map((thread) => ({
      id: thread.id,
      title: readableTitle(openThreadTitle(cipher, thread.id, thread.title)),
      updatedAt: thread.updatedAt,
      modelCount: new Set(
        thread.turns.flatMap((turn) =>
          turn.responses.map((response) => response.modelId),
        ),
      ).size,
    })),
    now,
  );
};

/**
 * The signed-in person's threads, or none. A sidebar that cannot be read must
 * not take the page down with it, so a failed read is logged and shows as an
 * empty list; Next's redirect and not-found signals are passed on untouched.
 */
export const threadsForViewer = (
  actorId: () => Promise<string | null>,
  appUserIdFor: (actorId: string) => Promise<string | null>,
): Promise<readonly ThreadGroup[]> =>
  actorId()
    .then((actor) => (actor ? appUserIdFor(actor) : null))
    .then((userId) => (userId ? listThreadHistory(userId) : []))
    .catch((failure: unknown) => {
      unstable_rethrow(failure);
      console.error("[shell] sidebar threads unavailable", failure);
      return [];
    });
