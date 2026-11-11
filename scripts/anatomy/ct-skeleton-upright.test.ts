import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { prepareSkeleton } from "@/features/digital-twin/anatomy/prepare-skeleton";
import { fitSkeletonToScan, type ScanFrame } from "@/packages/anatomy/fit";
import { parseSkeletonAtlas } from "@/packages/anatomy/open-skeleton";

/**
 * Checks the placement on a real open-anatomy build. The GLB is public CC BY
 * CT data but never committed, so this runs only where ANATOMY_SKELETON_GLB
 * names one (e.g. open-anatomy's data/atlas/s0086/s0086.skeleton.glb).
 */
const GLB = process.env.ANATOMY_SKELETON_GLB ?? "";
const present = GLB.length > 0 && existsSync(GLB);

/** The male demo body's frame: 1.91 m, Z-up, hips at 0.97 m. */
const SCAN: ScanFrame = {
  box: new Box3(new Vector3(-0.3, -0.15, 0), new Vector3(0.3, 0.15, 1.91)),
  floorZ: 0,
  height: 1.91,
  stature: null,
  hipMidpoint: new Vector3(0, 0, 0.97),
};

const degrees = (radians: number): number => (radians * 180) / Math.PI;

describe.skipIf(!present)("a real CT skeleton, placed in a body", () => {
  const load = async () => {
    const bytes = readFileSync(GLB);
    const atlasPath = join(dirname(GLB), "atlas.json");
    const atlas = parseSkeletonAtlas(
      existsSync(atlasPath) ? JSON.parse(readFileSync(atlasPath, "utf8")) : {},
    );
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const prepared = prepareSkeleton(gltf.scene, atlas);
    const fit = fitSkeletonToScan(
      { box: prepared.box, hipBox: prepared.hipBox, spine: prepared.spine },
      SCAN,
    );
    const placed = (label: string): Vector3 => {
      const part = prepared.parts.find((item) => item.label === label);
      if (!part) throw new Error(`no ${label}`);
      return new Box3()
        .setFromObject(part.mesh)
        .getCenter(new Vector3())
        .applyMatrix4(fit.matrix);
    };
    return { prepared, fit, placed };
  };

  test("the T1 to L5 axis stands within 2 degrees of vertical", async () => {
    const { fit, placed } = await load();
    expect(fit.ok).toBe(true);
    const axis = placed("First thoracic vertebra").sub(placed("Fifth lumbar vertebra"));
    expect(degrees(axis.angleTo(new Vector3(0, 0, 1)))).toBeLessThan(2);
  });

  test("the sternum is in front of the spine (the body faces -Y)", async () => {
    const { placed } = await load();
    expect(placed("Sternum").y).toBeLessThan(
      placed("Seventh thoracic vertebra").y - 0.05,
    );
  });

  test("the hip bones sit either side of the body's hip joints", async () => {
    const { placed } = await load();
    const left = placed("Left hip bone");
    const right = placed("Right hip bone");
    expect(left.x).toBeGreaterThan(0.05);
    expect(right.x).toBeLessThan(-0.05);
    expect(Math.abs((left.z + right.z) / 2 - 0.97)).toBeLessThan(0.1);
  });
});
