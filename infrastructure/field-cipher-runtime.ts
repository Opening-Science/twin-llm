import "server-only";

import { database } from "./database";
import { vaultEnv } from "./env";
import { type FieldCipher, plainCipher, sealedCipher } from "./field-cipher";
import { LOCKED_MESSAGE } from "./vault-gate";
import { type VaultKeys, vaultSessions } from "./vault-session";

/**
 * The cipher a store uses for one person's rows (#141). Synthetic installs
 * get the plain cipher. A personal install gets one built from the keys in
 * this process's session store, which exist only while that person's vault
 * is open: locked, there is no key, so a store cannot read or write a
 * personal column at all. The unlock cookie is checked by the gate in front
 * of every route, page and action; this only answers "is a key in memory".
 */

export class PersonalDataLockedError extends Error {
  constructor() {
    super(LOCKED_MESSAGE);
    this.name = "PersonalDataLockedError";
  }
}

export const cipherOfKeys = (keys: VaultKeys): FieldCipher =>
  sealedCipher(keys, keys.retiring);

/** The cipher of a signed-in actor (`User.clerkId`); throws while their vault is locked. */
export const cipherForActor = (actorId: string): FieldCipher => {
  const env = vaultEnv();
  if (env.dataMode !== "personal") return plainCipher;
  const keys = vaultSessions().keysOf(actorId, env.idleLockMs);
  if (keys === null) throw new PersonalDataLockedError();
  return cipherOfKeys(keys);
};

/** `users.id` to `clerkId` never changes, so a lookup is kept for the process. */
const actorOfUser = new Map<string, string>();

const actorIdOfUser = async (userId: string): Promise<string> => {
  const known = actorOfUser.get(userId);
  if (known !== undefined) return known;
  const row = await database().user.findUnique({
    where: { id: userId },
    select: { clerkId: true },
  });
  if (row === null) throw new PersonalDataLockedError();
  actorOfUser.set(userId, row.clerkId);
  return row.clerkId;
};

/** The cipher of the person who owns `users.id`; throws while their vault is locked. */
export const cipherForUser = async (userId: string): Promise<FieldCipher> =>
  vaultEnv().dataMode === "personal"
    ? cipherForActor(await actorIdOfUser(userId))
    : plainCipher;
