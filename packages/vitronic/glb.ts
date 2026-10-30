import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { vitronicEnv } from "@/infrastructure/env";

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

export const persistGlb = async (userId: string, bytes: Uint8Array): Promise<string> => {
  assertGlbSize(bytes);
  const sha = sha256Hex(bytes);
  const dir = join(/* turbopackIgnore: true */ dataDir(), safeUserId(userId));
  // Owner-only even if the umask was not set (#144): body scans are personal data.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${sha}.glb`), bytes, { mode: 0o600 });
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

export const loadGlb = async (
  userId: string,
  sha: string,
): Promise<Uint8Array | null> => {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  try {
    return await readFile(
      join(/* turbopackIgnore: true */ dataDir(), safeUserId(userId), `${sha}.glb`),
    );
  } catch {
    return null;
  }
};
