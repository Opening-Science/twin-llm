import "server-only";

import { readFile, stat } from "node:fs/promises";

import { anatomyEnv } from "@/infrastructure/env";

import { DEMO_BODIES, type DemoBodyId } from "./demo-bodies";
import { ATLASES, type AtlasId } from "./manifest";
import { atlasFilePath, demoBodyFilePath, resolveAnatomyDir } from "./paths";

const anatomyDir = (): string => resolveAnatomyDir(anatomyEnv().dataDir, process.cwd());

/** Installed means present at exactly the pinned size; a partial file is not. */
const statPinned = async (path: string, bytes: number): Promise<boolean> => {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === bytes;
  } catch {
    return false;
  }
};

/** The file's bytes, or null when it is not installed. */
const openPinned = async (
  path: string,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (!(await statPinned(path, bytes))) return null;
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
};

export const statAtlas = (id: AtlasId): Promise<boolean> =>
  statPinned(atlasFilePath(anatomyDir(), id), ATLASES[id].bytes);

/** The atlas bytes, or null when it is not installed. */
export const openAtlas = (id: AtlasId): Promise<Uint8Array<ArrayBuffer> | null> =>
  openPinned(atlasFilePath(anatomyDir(), id), ATLASES[id].bytes);

/** The demo body's bytes, or null when it is not installed. */
export const openDemoBody = (id: DemoBodyId): Promise<Uint8Array<ArrayBuffer> | null> =>
  openPinned(demoBodyFilePath(anatomyDir(), id), DEMO_BODIES[id].bytes);
