import { taskNotice } from "@/features/tasks/task-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vaultShellState } from "@/infrastructure/vault-runtime";

/**
 * `GET /api/tasks/notice` (#54): how many scheduled runs finished that the
 * person asked to hear about and has not seen, and the newest one's skill
 * and thread. No question and no answer text. Polled by the shell, so it
 * does not count as use of the vault: while locked it answers zero instead
 * of keeping the vault open.
 */
const NOTHING = { unseen: 0, latest: null } as const;

export const GET = async (): Promise<Response> => {
  if (!(await vaultShellState()).unlocked) return Response.json(NOTHING);
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  if (userId === null) return Response.json(NOTHING);
  try {
    return Response.json(await taskNotice(userId));
  } catch (error) {
    console.error(
      "[tasks] notice read failed",
      error instanceof Error ? error.name : "unknown",
    );
    return Response.json(NOTHING);
  }
};
