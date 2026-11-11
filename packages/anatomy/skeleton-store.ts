import "server-only";

import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { anatomyEnv } from "@/infrastructure/env";

import { parseSkeletonAtlas, type SkeletonAtlas } from "./open-skeleton";

/**
 * The open-anatomy skeleton named by ANATOMY_SKELETON_GLB, with atlas.json
 * beside it. Not pinned like the atlases: it is a local build that changes as
 * open-anatomy improves, so the ETag is its size and modification time. When
 * nothing is configured, or the file is missing, every call answers null and
 * the layer is simply absent.
 */
const configured = (): string | null => anatomyEnv().skeletonGlb;

export type SkeletonFileInfo = Readonly<{ etag: string }>;

/** The file's validator, or null when no skeleton is configured or the file is missing. */
export const statSkeleton = async (): Promise<SkeletonFileInfo | null> => {
  const path = configured();
  if (!path) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;
    return {
      etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
    };
  } catch {
    return null;
  }
};

/** The GLB's bytes, or null when it is not there. */
export const openSkeleton = async (): Promise<Uint8Array<ArrayBuffer> | null> => {
  const path = configured();
  if (!path) return null;
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
};

/** The case id open-anatomy puts first in a file name: `s0086.skeleton.glb` → `s0086`. */
const caseFromFile = (path: string): string | null =>
  basename(path).split(".")[0] || null;

/**
 * What atlas.json says about the configured skeleton, or null when there is no
 * skeleton. A missing or unreadable atlas.json leaves nothing out and marks
 * nothing modelled beyond the GLB's own extras; the case comes from the file name.
 */
export const readSkeletonAtlas = async (): Promise<SkeletonAtlas | null> => {
  const path = configured();
  if (!path || !(await statSkeleton())) return null;
  const raw = await readFile(join(dirname(path), "atlas.json"), "utf8").catch(() => null);
  let value: unknown = {};
  try {
    value = raw === null ? {} : JSON.parse(raw);
  } catch {
    console.error("[anatomy] atlas.json beside the skeleton is not valid JSON");
  }
  const atlas = parseSkeletonAtlas(value);
  return atlas.caseId ? atlas : { ...atlas, caseId: caseFromFile(path) };
};
