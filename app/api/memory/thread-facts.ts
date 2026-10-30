import { loadOwnedThread } from "@/features/arena/owned-thread";
import { threadReads } from "@/features/arena/thread-reads";
import { loadGenomeThread } from "@/features/chat/load-genome-thread";
import type { CompactThread } from "@/features/memory/compact-draft";

/**
 * The thread reads both memory routes share: the person's own thread (the
 * same rule as `/t/<id>`), and whether it used a genome or imported-data
 * tool, which makes its notes local only.
 */
export const ownedThreadForNote = (threadId: string): Promise<CompactThread | null> =>
  loadOwnedThread(threadId, threadReads);

export const threadIsLocal = async (thread: CompactThread): Promise<boolean> => {
  const first = thread.turns[0];
  return first === undefined ? false : (await loadGenomeThread(first.id)).usedGenome;
};
