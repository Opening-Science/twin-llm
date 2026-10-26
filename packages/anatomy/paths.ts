import { join, resolve } from "node:path";

import { DEMO_BODIES, type DemoBodyId } from "./demo-bodies";
import { ATLASES, type AtlasId } from "./manifest";
import { RIGGED_BODIES } from "./rigged-bodies";

/**
 * Where the fetched atlases live. Shared by the fetch script (which reads the
 * env directly) and the server store (which reads it through anatomyEnv()), so
 * both always agree on the same file.
 */
export const DEFAULT_ANATOMY_DIR = join("data", "anatomy");

export const resolveAnatomyDir = (
  envValue: string | null | undefined,
  cwd: string,
): string => resolve(cwd, envValue || DEFAULT_ANATOMY_DIR);

/** Only closed-set ids reach this, so there is no path traversal to guard. */
export const atlasFilePath = (dir: string, id: AtlasId): string =>
  join(dir, ATLASES[id].fileName);

/** Demo bodies live next to the atlases; same closed-set guarantee. */
export const demoBodyFilePath = (dir: string, id: DemoBodyId): string =>
  join(dir, DEMO_BODIES[id].fileName);

/** Rigged demo bodies are baked into the same dir; same closed-set guarantee. */
export const riggedBodyFilePath = (dir: string, id: DemoBodyId): string =>
  join(dir, RIGGED_BODIES[id].fileName);
