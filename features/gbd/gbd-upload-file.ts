import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { storageEnv } from "@/infrastructure/env";

import type { SavedUpload } from "./gbd-import-routes";

/**
 * Where an uploaded GBD file waits while it is read (#426): one file per
 * upload in `<state folder>/gbd-uploads`, owner-only, removed as soon as the
 * import ends. The upload is written as it arrives and hashed on the way, so
 * the server never holds the whole file in memory.
 */

/** Read size for the import: a megabyte of text per chunk. */
const READ_CHUNK_BYTES = 1024 * 1024;
/** A file left behind by a stopped server is removed by the next upload after this. */
const STALE_MS = 60 * 60 * 1000;

export const gbdUploadDir = (): string => join(storageEnv().stateDir, "gbd-uploads");

const removeStale = async (dir: string, now: number): Promise<void> => {
  const names = await readdir(dir).catch(() => []);
  await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info !== null && now - info.mtimeMs > STALE_MS) {
        await rm(path, { force: true });
      }
    }),
  );
};

/** Streams `body` to a new owner-only file; stops and removes it past `maxBytes`. */
export const saveUpload = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  dir: string = gbdUploadDir(),
): Promise<SavedUpload> => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await removeStale(dir, Date.now());
  const path = join(dir, `${randomUUID()}.csv`);
  const handle = await open(path, "wx", 0o600);
  const hash = createHash("sha256");
  // Mutable on purpose: the byte count of this one upload.
  const seen = { bytes: 0 };
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.bytes += value.byteLength;
      if (seen.bytes > maxBytes) {
        await reader.cancel();
        await handle.close();
        await rm(path, { force: true });
        return { ok: false, reason: "too-large" };
      }
      hash.update(value);
      await handle.write(value);
    }
    await handle.close();
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true });
    throw error;
  }
  if (seen.bytes === 0) {
    await rm(path, { force: true });
    return { ok: false, reason: "empty" };
  }
  return { ok: true, path, sha256: hash.digest("hex"), bytes: seen.bytes };
};

export const uploadChunks = (path: string): AsyncIterable<Uint8Array> =>
  createReadStream(path, { highWaterMark: READ_CHUNK_BYTES });

export const removeUpload = (path: string): Promise<void> => rm(path, { force: true });
