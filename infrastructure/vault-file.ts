import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { type KdfParams, type WrappedKey } from "./vault-crypto";

/**
 * Where a person's wrapped data key lives: one owner-only JSON file per local
 * user in `$TWINLLM_STATE_DIR/vault/` (#142). It holds the KDF parameters,
 * the salts and the data key wrapped twice (under the passphrase and under
 * the recovery code). Nothing in it opens without one of the two.
 *
 * The file sits in the state directory rather than in Postgres so that the
 * #144 startup check (0700 folder, 0600 files, owned by the person) covers
 * it, and so that a database dump alone never carries the wrapped key.
 */

export const VAULT_DIR_NAME = "vault";

/** A stable, path-safe name for an actor id; the id itself is not written to disk. */
export const vaultUserKey = (actorId: string): string =>
  createHash("sha256").update(`twinllm.vault.user|${actorId}`).digest("hex").slice(0, 32);

export const vaultFilePath = (stateDir: string, actorId: string): string =>
  join(
    /* turbopackIgnore: true */ stateDir,
    VAULT_DIR_NAME,
    `${vaultUserKey(actorId)}.json`,
  );

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);

const kdfSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("argon2id"),
    memoryKiB: z.number().int(),
    passes: z.number().int(),
    parallelism: z.number().int(),
    salt: base64Url,
  }),
  z.object({
    name: z.literal("scrypt"),
    N: z.number().int(),
    r: z.number().int(),
    p: z.number().int(),
    salt: base64Url,
  }),
]);

const wrappedSchema = z.object({
  kdf: kdfSchema,
  iv: base64Url,
  data: base64Url,
});

const keyIdSchema = z.string().regex(/^[0-9a-f]{16}$/);

const retiringSchema = z.object({
  keyId: keyIdSchema,
  passphrase: wrappedSchema,
  recovery: wrappedSchema,
});

const recordSchema = z.object({
  v: z.literal(1),
  userKey: z.string().regex(/^[0-9a-f]{32}$/),
  keyId: keyIdSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  passphrase: wrappedSchema,
  recovery: wrappedSchema,
  retiring: z.array(retiringSchema).optional(),
});

export type WrappedWith = Readonly<{ kdf: KdfParams } & WrappedKey>;

/**
 * A data key being rotated out (#141): rows not yet rewritten still name it,
 * so it opens with the same passphrase and recovery code until the rotation
 * finishes and removes it.
 */
export type RetiringKey = Readonly<{
  keyId: string;
  passphrase: WrappedWith;
  recovery: WrappedWith;
}>;

export type VaultRecord = Readonly<{
  v: 1;
  userKey: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
  passphrase: WrappedWith;
  recovery: WrappedWith;
  retiring?: readonly RetiringKey[];
}>;

/** A stored record, or null when the text is not one. */
export const parseVaultRecord = (text: string): VaultRecord | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = recordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const serializeVaultRecord = (record: VaultRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;

export type VaultRead =
  | Readonly<{ kind: "found"; record: VaultRecord }>
  | Readonly<{ kind: "missing" }>
  /** The file exists but cannot be read or parsed; never taken for "no vault". */
  | Readonly<{ kind: "unreadable" }>;

const errorCode = (error: unknown): string | null => {
  const code =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return typeof code === "string" ? code : null;
};

export const readVaultRecord = async (
  stateDir: string,
  actorId: string,
): Promise<VaultRead> => {
  try {
    const record = parseVaultRecord(
      await readFile(vaultFilePath(stateDir, actorId), "utf8"),
    );
    return record === null ? { kind: "unreadable" } : { kind: "found", record };
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
};

/**
 * Writes the record owner-only (folder 0700, file 0600) through a temporary
 * file and a rename, so a crash never leaves half a key file.
 */
export const writeVaultRecord = async (
  stateDir: string,
  actorId: string,
  record: VaultRecord,
): Promise<void> => {
  const dir = join(/* turbopackIgnore: true */ stateDir, VAULT_DIR_NAME);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const target = vaultFilePath(stateDir, actorId);
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(serializeVaultRecord(record), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};
