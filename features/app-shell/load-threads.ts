import "server-only";

import { unstable_rethrow } from "next/navigation";

import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import { readableTitle } from "@/infrastructure/readable-title";
import type { ShellThread } from "@/infrastructure/recent-threads";
import { openThreadTitle } from "@/infrastructure/thread-fields";

/**
 * Every thread the viewer owns, newest activity first, for the sidebar, the
 * search box's recents and the Customize · Tasks thread picker. Per thread:
 * its id, its title opened with the owner's key and made scannable, its last
 * activity and how many distinct models answered in it. Only model ids are
 * read from the answers, never their text. Stored titles are not rewritten.
 *
 * The caller reads it only while the vault is open. A failed read is logged
 * and gives an empty list, so a broken sidebar never takes the page down;
 * Next's redirect and not-found signals pass through.
 */
export const threadsForViewer = async (
  appUserId: string | null,
): Promise<readonly ShellThread[]> => {
  if (appUserId === null) return [];
  try {
    const [rows, cipher] = await Promise.all([
      database().thread.findMany({
        where: { userId: appUserId },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          turns: { select: { responses: { select: { modelId: true } } } },
        },
      }),
      cipherForUser(appUserId),
    ]);
    return rows.map((row) => ({
      id: row.id,
      title: readableTitle(openThreadTitle(cipher, row.id, row.title)),
      updatedAt: row.updatedAt.toISOString(),
      modelCount: new Set(
        row.turns.flatMap((turn) => turn.responses.map(({ modelId }) => modelId)),
      ).size,
    }));
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      "[app-shell] thread list not read",
      error instanceof Error ? error.name : typeof error,
    );
    return [];
  }
};
