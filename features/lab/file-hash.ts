import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/**
 * SHA-256 of a file on this machine for the Pinned artefacts card. A file that
 * is missing, or that cannot be read (no permission, removed mid-read), is a
 * result of its own, so one bad file never hides the rows of the others.
 *
 * Results are kept so a reload does not re-read a 200 MB JAR. The key holds
 * the device, inode, size, modification and change time: restoring an old
 * modification time (`touch -r`) still moves the change time, so a replaced
 * file is hashed again. Entries also expire after `ttlMs`, and two loads that
 * ask for the same file at once share one read.
 */

export type FileHash =
  | Readonly<{ kind: "hash"; sha256: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>;

export type FileIdentity = Readonly<{
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

/** The cache key for one file as it is now. */
export const fileHashKey = (path: string, found: FileIdentity): string =>
  [path, found.dev, found.ino, found.size, found.mtimeMs, found.ctimeMs].join("\0");

export const sha256OfStream = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

const isNotFound = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export type FileHasherOptions = Readonly<{
  ttlMs?: number;
  now?: () => number;
  hashFile?: (path: string) => Promise<string>;
}>;

/** Ten minutes: long enough for reloads, short enough to notice a change. */
export const FILE_HASH_TTL_MS = 10 * 60 * 1000;

export const createFileHasher = ({
  ttlMs = FILE_HASH_TTL_MS,
  now = Date.now,
  hashFile = sha256OfStream,
}: FileHasherOptions = {}) => {
  const done = new Map<string, Readonly<{ sha256: string; at: number }>>();
  const running = new Map<string, Promise<FileHash>>();

  const hashOnce = (key: string, path: string): Promise<FileHash> => {
    const pending = running.get(key);
    if (pending !== undefined) return pending;
    const started = hashFile(path).then(
      (sha256): FileHash => {
        done.set(key, { sha256, at: now() });
        return { kind: "hash", sha256 };
      },
      (): FileHash => ({ kind: "unreadable" }),
    );
    const tracked = started.finally(() => running.delete(key));
    running.set(key, tracked);
    return tracked;
  };

  return async (path: string): Promise<FileHash> => {
    const found = await stat(path).catch((error: unknown) =>
      isNotFound(error) ? null : ("unreadable" as const),
    );
    if (found === "unreadable") return { kind: "unreadable" };
    if (found === null || !found.isFile()) return { kind: "missing" };
    const key = fileHashKey(path, found);
    const cached = done.get(key);
    if (cached !== undefined && now() - cached.at < ttlMs) {
      return { kind: "hash", sha256: cached.sha256 };
    }
    done.delete(key);
    return hashOnce(key, path);
  };
};
