import { createHash } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type FieldCipher } from "./field-cipher";
import { envelopeKeyId } from "./field-crypto";

/**
 * BodyLoop mesh files at rest (#141). A personal install keeps each mesh as
 * `<sha>.glb.enc`: the binary envelope of `field-crypto.ts` under the mesh
 * subkey, bound to its owner and the SHA-256 of its plaintext. A synthetic
 * install keeps `<sha>.glb` as it is. `resealMeshFiles` is the migration and
 * rotation step for one owner's folder.
 */

const SHA = /^[0-9a-f]{64}$/;

/** The context a sealed mesh file is bound to: its owner and the hash of its plaintext. */
export const meshContext = (userId: string, sha: string): string =>
  `vitronic.mesh.${userId}.${sha}`;

/** `<sha>.glb` in a synthetic install; `<sha>.glb.enc` in a personal one. */
export const meshFileName = (sha: string, sealed: boolean): string =>
  sealed ? `${sha}.glb.enc` : `${sha}.glb`;

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Writes owner-only through a temporary file and a rename, so a crash never leaves half a file. */
export const writeOwnerOnly = async (target: string, body: Uint8Array): Promise<void> => {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, body, { mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

export class MeshCheckError extends Error {
  constructor() {
    super("a mesh file did not match its hash");
    this.name = "MeshCheckError";
  }
}

const sealChecked = async (
  cipher: FieldCipher,
  userId: string,
  sha: string,
  plain: Buffer,
  target: string,
): Promise<void> => {
  if (sha256Hex(plain) !== sha) throw new MeshCheckError();
  await writeOwnerOnly(target, cipher.sealFile(meshContext(userId, sha), plain));
  const back = cipher.openFile(meshContext(userId, sha), await readFile(target));
  if (sha256Hex(back) !== sha) throw new MeshCheckError();
};

export type MeshCounts = Readonly<{
  sealed: number;
  resealed: number;
  unchanged: number;
}>;

const errorCode = (error: unknown): string | null => {
  const code =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return typeof code === "string" ? code : null;
};

/**
 * Seals every plain mesh in one owner's folder (checked, then the plain file
 * removed) and reseals every sealed one that names another key than the
 * active one. Resumable: a plain file whose sealed copy already opens is
 * only removed; a file already under the active key is left alone.
 */
export const resealMeshFiles = async (
  dir: string,
  userId: string,
  cipher: FieldCipher,
): Promise<MeshCounts> => {
  if (cipher.mode !== "sealed" || cipher.activeKeyId === null) {
    throw new Error("mesh files are sealed only with a personal key");
  }
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { sealed: 0, resealed: 0, unchanged: 0 };
    throw error;
  }
  const counts = { sealed: 0, resealed: 0, unchanged: 0 };
  for (const name of names) {
    const sha = name.replace(/\.glb(\.enc)?$/, "");
    if (!SHA.test(sha)) continue;
    const path = join(dir, name);
    const target = join(dir, meshFileName(sha, true));
    if (name === meshFileName(sha, false)) {
      const plain = await readFile(path);
      if (names.includes(meshFileName(sha, true))) {
        // A run stopped after sealing: the sealed copy must open to the same bytes.
        const back = cipher.openFile(meshContext(userId, sha), await readFile(target));
        if (!back.equals(plain)) throw new MeshCheckError();
      } else {
        await sealChecked(cipher, userId, sha, plain, target);
      }
      await rm(path);
      counts.sealed += 1;
    } else if (name === meshFileName(sha, true)) {
      const stored = await readFile(path);
      if (envelopeKeyId(stored) === cipher.activeKeyId) {
        counts.unchanged += 1;
        continue;
      }
      const plain = cipher.openFile(meshContext(userId, sha), stored);
      await sealChecked(cipher, userId, sha, plain, target);
      counts.resealed += 1;
    }
  }
  return counts;
};

/** How many sealed mesh files in one owner's folder still name `keyId`. */
export const meshFilesWithKey = async (dir: string, keyId: string): Promise<number> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }
  let count = 0;
  for (const name of names.filter((each) => each.endsWith(".glb.enc"))) {
    if (envelopeKeyId(await readFile(join(dir, name))) === keyId) count += 1;
  }
  return count;
};
