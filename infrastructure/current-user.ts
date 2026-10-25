import "server-only";

import { database } from "./database";

/**
 * Maps a Clerk identity to this app's own `users.id`.
 *
 * Rows are created lazily: `ensureAppUser` runs where a signed-in person first
 * writes something (starting a turn, connecting a source), and every read path
 * uses `findAppUserId`, which never writes. That keeps user creation in a few
 * known places and avoids a Clerk webhook and its signing secret.
 */

export const ensureAppUser = async (
  clerkId: string,
): Promise<{ readonly id: string }> => {
  const row = await database().user.upsert({
    where: { clerkId },
    update: {},
    create: { clerkId },
    select: { id: true },
  });
  return { id: row.id };
};

export const findAppUserId = async (clerkId: string): Promise<string | null> =>
  database()
    .user.findUnique({ where: { clerkId }, select: { id: true } })
    .then((row) => (row === null ? null : row.id));
