import { describe, expect, test } from "bun:test";

import { ATLAS_JOINTS_MEASURED_ON, atlasJoints } from "./atlas-joints";
import { ATLAS_IDS, ATLASES } from "./manifest";
import { trunkFrame } from "./segments";

describe("atlasJoints", () => {
  test("was measured on the pinned files: a new pin means measuring the joints again", () => {
    for (const id of ATLAS_IDS) {
      expect(ATLASES[id].sha256).toBe(ATLAS_JOINTS_MEASURED_ON[id]);
    }
  });

  test("every atlas stands upright with its left on +X and its legs below its hips", () => {
    for (const id of ATLAS_IDS) {
      const joints = atlasJoints(id);
      const trunk = trunkFrame(joints);
      expect(trunk.axis.y).toBeGreaterThan(0.99);
      expect(trunk.left.x).toBeGreaterThan(0.99);
      expect(trunk.front.z).toBeGreaterThan(0.99);
      for (const side of ["L", "R"] as const) {
        expect(joints.knee[side].y).toBeLessThan(joints.hip[side].y - 0.3);
        expect(joints.ankle[side].y).toBeLessThan(joints.knee[side].y - 0.3);
        expect(joints.elbow[side].y).toBeLessThan(joints.shoulder[side].y);
        expect(Math.sign(joints.wrist[side].x)).toBe(side === "L" ? 1 : -1);
      }
    }
  });
});
