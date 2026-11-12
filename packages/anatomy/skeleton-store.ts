import "server-only";

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { anatomyEnv } from "@/infrastructure/env";

import { parseSkeletonAtlas, type SkeletonAtlas } from "./open-skeleton";

/**
 * The open-anatomy skeleton named by ANATOMY_SKELETON_GLB, with atlas.json
 * beside it. Pinned like the atlases, but by ANATOMY_SKELETON_SHA256 rather
 * than a manifest, since it is a local build: a new build needs a new pin.
 * When nothing is configured, the file is missing or its hash is not the pin,
 * every call answers null and the CT skeleton is not shown.
 */
const configured = (): Readonly<{ path: string; sha256: string }> | null => {
  const { skeletonGlb, skeletonSha256: sha256 } = anatomyEnv();
  return skeletonGlb && sha256 ? { path: skeletonGlb, sha256 } : null;
};

/** The configured pin, or null when no skeleton is configured. */
export const skeletonSha256 = (): string | null => configured()?.sha256 ?? null;

const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The GLB's bytes when they hash to the pin; null when missing or not the pinned file. */
export const openSkeleton = async (): Promise<Uint8Array<ArrayBuffer> | null> => {
  const pin = configured();
  if (!pin) return null;
  try {
    const bytes = new Uint8Array(await readFile(pin.path));
    if (sha256Of(bytes) === pin.sha256) return bytes;
    console.error("[anatomy] the skeleton GLB does not match ANATOMY_SKELETON_SHA256");
    return null;
  } catch {
    return null;
  }
};

/** Whether the configured skeleton is here and is the pinned file. */
export const statSkeleton = async (): Promise<boolean> => {
  const path = configured()?.path;
  if (!path) return false;
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0 && (await openSkeleton()) !== null;
  } catch {
    return false;
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
  const path = configured()?.path;
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
