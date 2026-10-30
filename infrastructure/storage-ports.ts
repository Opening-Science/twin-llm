import { lstat, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { type PathFacts } from "./storage-hardening";
import { type WalkResult } from "./storage-scan";

/**
 * The file-system half of the storage checks (#144), for the server and the
 * scripts alike. Errors become facts (`missing`, `unreadable`); no message
 * that could hold a path leaves this module.
 */

/** A data folder with more entries than this is reported as only partly checked. */
export const WALK_LIMIT = 20_000;

const errorCode = (error: unknown): string | null => {
  const code =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return typeof code === "string" ? code : null;
};

const factsOf = (info: { mode: number; uid: number; isDirectory: () => boolean }) =>
  ({
    kind: "found",
    mode: info.mode & 0o777,
    uid: info.uid,
    directory: info.isDirectory(),
  }) as const;

/** `stat` (following a symlink) as facts. */
export const statFacts = async (path: string): Promise<PathFacts> => {
  try {
    return factsOf(await stat(path));
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
};

/**
 * Every entry under `dir`, depth first, without following symlinks (a link's
 * own mode says nothing about its target, and the target is checked where it
 * lives). A missing `dir` gives no entries; a folder that cannot be listed
 * makes the whole result null.
 */
export const walkFacts = async (dir: string, limit = WALK_LIMIT): Promise<WalkResult> => {
  const found: PathFacts[] = [];
  const pending: string[] = [dir];
  try {
    while (pending.length > 0) {
      const current = pending.pop() as string;
      const names = await readdir(current).catch((error: unknown) => {
        if (current === dir && errorCode(error) === "ENOENT") return [];
        throw error;
      });
      for (const name of names) {
        if (found.length >= limit) return { files: found, truncated: true };
        const path = join(/* turbopackIgnore: true */ current, name);
        const info = await lstat(path).catch(() => null);
        if (info === null) {
          found.push({ kind: "unreadable" });
        } else if (!info.isSymbolicLink()) {
          found.push(factsOf(info));
          if (info.isDirectory()) pending.push(path);
        }
      }
    }
  } catch {
    return { files: null, truncated: false };
  }
  return { files: found, truncated: false };
};

/** Creates a folder owner-only (and any missing parents) when it does not exist. */
export const ensureOwnerDir = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true, mode: 0o700 });
};

/** The effective user id; -1 where the platform has none (never matches a file). */
export const ownUid = (): number =>
  typeof process.getuid === "function" ? process.getuid() : -1;
