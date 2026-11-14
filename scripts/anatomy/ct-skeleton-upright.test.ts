import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { prepareSkeleton } from "@/features/digital-twin/anatomy/prepare-skeleton";
import { fitSkeletonToScan, type ScanFrame } from "@/packages/anatomy/fit";
import { skeletonFromAtlasJson } from "@/packages/anatomy/open-skeleton";

/**
 * Checks the placement on a real open-anatomy build, with atlas.json beside it.
 *
 * This is skipped in CI, on purpose. It needs a real CT case, and this
 * repository commits synthetic or demo data only: the build is derived from
 * one person's (anonymised, CC BY 4.0) CT, is 28 MB for s0086, and changes
 * with every open-anatomy build, so no copy or cut-down fixture of it is
 * committed. CI covers the same placement rules on synthetic bones instead
 * (`packages/anatomy/fit.test.ts`, "fitSkeletonToScan": hips on the joints,
 * a leaning spine stood upright, front facing -Y; `prepare-skeleton.test.ts`
 * for the hip box and spine ends). What only this test catches is a real
 * file's own frame or labels differing from what those assume. Run it
 * locally, before a new build or a change to the fit, with
 * ANATOMY_SKELETON_GLB=/path/to/open-anatomy/data/atlas/s0086/s0086.skeleton.glb.
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
    // The same fail-closed reading as the status route.
    const status = skeletonFromAtlasJson(
      existsSync(atlasPath) ? readFileSync(atlasPath, "utf8") : null,
      null,
    );
    if (!status.skeleton) throw new Error(`atlas.json beside the GLB: ${status.problem}`);
    const atlas = status.skeleton;
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
