/**
 * Which fitted atlases to quantise, where they land, and how the result is
 * checked. Pure, so it is tested without glTF-Transform or Blender.
 *
 * Blender writes float positions without `KHR_mesh_quantization`, so its
 * fitted atlases are about half as big again as the pinned atlases. The
 * quantise step stores positions as 16-bit integers per mesh and colours as
 * 8 bits, like the pinned files, and keeps every vertex within
 * `MAX_DEVIATION_M` of where Blender put it.
 */
import { join } from "node:path";

import { ATLAS_IDS, type AtlasId } from "../../packages/anatomy/manifest";
import { DEMO_BODY_IDS, type DemoBodyId } from "../../packages/anatomy/demo-bodies";
import {
  FITTED_ATLASES,
  type FittedAtlasEntry,
} from "../../packages/anatomy/fitted-atlases";
import { fittedAtlasFilePath } from "../../packages/anatomy/paths";
import { fittedDir } from "./fit-plan";

/** Every quantised vertex stays within 1 mm of the Blender output. */
export const MAX_DEVIATION_M = 0.001;

/** Bits per position component (per mesh box) and per colour channel. */
export const QUANTISE_BITS = { position: 14, color: 8 } as const;

export type QuantiseJob = Readonly<{
  bodyId: DemoBodyId;
  atlasId: AtlasId;
  /** Blender's output (`blender:fit-atlas`). */
  source: string;
  /** The quantised file the app serves. */
  out: string;
  pin: FittedAtlasEntry;
}>;

export const quantiseJobs = (
  anatomyDir: string,
  bodies: readonly DemoBodyId[] = DEMO_BODY_IDS,
  atlases: readonly AtlasId[] = ATLAS_IDS,
): QuantiseJob[] =>
  bodies.flatMap((bodyId) =>
    atlases.map((atlasId) => {
      const pin = FITTED_ATLASES[bodyId][atlasId];
      return {
        bodyId,
        atlasId,
        source: join(fittedDir(anatomyDir), pin.sourceFileName),
        out: fittedAtlasFilePath(anatomyDir, bodyId, atlasId),
        pin,
      };
    }),
  );

/**
 * The largest distance between matching vertices of two position lists
 * (x, y, z triples in the same order and frame), in the lists' unit. Infinity
 * when the lists differ in length, so a dropped vertex never passes.
 */
export const maxDeviation = (
  before: ArrayLike<number>,
  after: ArrayLike<number>,
): number => {
  if (before.length !== after.length || before.length % 3 !== 0) return Infinity;
  let worst = 0;
  for (let i = 0; i < before.length; i += 3) {
    const dx = (before[i] ?? 0) - (after[i] ?? 0);
    const dy = (before[i + 1] ?? 0) - (after[i + 1] ?? 0);
    const dz = (before[i + 2] ?? 0) - (after[i + 2] ?? 0);
    const distance = Math.hypot(dx, dy, dz);
    if (!(distance <= worst)) worst = Number.isNaN(distance) ? Infinity : distance;
  }
  return worst;
};

export type PinCheck =
  | Readonly<{ kind: "match" }>
  | Readonly<{ kind: "mismatch"; bytes: number; sha256: string }>;

export const checkPin = (
  actual: Readonly<{ bytes: number; sha256: string }>,
  pin: Readonly<{ bytes: number; sha256: string }>,
): PinCheck =>
  actual.bytes === pin.bytes && actual.sha256 === pin.sha256
    ? { kind: "match" }
    : { kind: "mismatch", bytes: actual.bytes, sha256: actual.sha256 };
