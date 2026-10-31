import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { vitronicEnv } from "@/infrastructure/env";
import type { FieldCipher } from "@/infrastructure/field-cipher";
import { FieldDecryptError } from "@/infrastructure/field-crypto";
import { meshContext, meshFileName, writeOwnerOnly } from "@/infrastructure/mesh-files";

export const MAX_GLB_BYTES = 100 * 1024 * 1024;

export class GlbTooLargeError extends Error {
  readonly status = 413;
  constructor() {
    super("vitronic-glb-too-large");
    this.name = "GlbTooLargeError";
  }
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const assertGlbSize = (bytes: Uint8Array): void => {
  if (bytes.byteLength > MAX_GLB_BYTES) throw new GlbTooLargeError();
};

const dataDir = (): string => {
  const env = vitronicEnv();
  return env?.dataDir ?? join(/* turbopackIgnore: true */ process.cwd(), "data/vitronic");
};

const safeUserId = (userId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error("vitronic-user-id-rejected");
  }
  return userId;
};

/**
 * Writes a mesh file owner-only. In personal mode it is sealed with the
 * owner's mesh key (#141) and written through a temporary file and a rename,
 * so a crash never leaves half a file; the name keeps the SHA-256 of the
 * plaintext, which the pin check and the snapshot row use.
 */
export const persistGlb = async (
  userId: string,
  bytes: Uint8Array,
  cipher: FieldCipher,
): Promise<string> => {
  assertGlbSize(bytes);
  const sha = sha256Hex(bytes);
  const dir = join(/* turbopackIgnore: true */ dataDir(), safeUserId(userId));
  // Owner-only even if the umask was not set (#144): body scans are personal data.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const sealed = cipher.mode === "sealed";
  const target = join(dir, meshFileName(sha, sealed));
  const body = sealed
    ? cipher.sealFile(meshContext(userId, sha), Buffer.from(bytes))
    : bytes;
  await writeOwnerOnly(target, body);
  return sha;
};

/** Read a response body, aborting if it exceeds MAX_GLB_BYTES. */
export const readBoundedBytes = async (response: Response): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > MAX_GLB_BYTES) throw new GlbTooLargeError();
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertGlbSize(bytes);
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_GLB_BYTES) {
      await reader.cancel();
      throw new GlbTooLargeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * The mesh file's plaintext, or null when there is none. A sealed file that
 * does not open, or whose plaintext does not match its hash, throws: it is
 * never served as a mesh.
 */
export const loadGlb = async (
  userId: string,
  sha: string,
  cipher: FieldCipher,
): Promise<Uint8Array | null> => {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const sealed = cipher.mode === "sealed";
  let stored: Buffer;
  try {
    stored = await readFile(
      join(
        /* turbopackIgnore: true */ dataDir(),
        safeUserId(userId),
        meshFileName(sha, sealed),
      ),
    );
  } catch {
    return null;
  }
  if (!sealed) return stored;
  const plain = cipher.openFile(meshContext(userId, sha), stored);
  if (sha256Hex(plain) !== sha) throw new FieldDecryptError("authentication");
  return plain;
};
