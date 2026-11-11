import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";

import {
  armFromSkin,
  bandCentre,
  fitSphere,
  headCentre,
  limbJoints,
  looseParts,
} from "./measure-joints";

/** Points round a straight rod from `a` to `b`. */
const rod = (a: Vector3, b: Vector3, radius = 0.012, count = 400): Vector3[] => {
  const axis = b.clone().sub(a).normalize();
  const u = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
  const v = new Vector3().crossVectors(axis, u);
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * 37 * i) / count;
    return a
      .clone()
      .lerp(b, i / (count - 1))
      .addScaledVector(u, radius * Math.cos(angle))
      .addScaledVector(v, radius * Math.sin(angle));
  });
};

const ball = (centre: Vector3, radius = 0.024): Vector3[] =>
  Array.from({ length: 300 }, (_, i) => {
    const polar = Math.acos(1 - (2 * (i + 0.5)) / 300);
    const turn = Math.PI * (1 + Math.sqrt(5)) * i;
    return new Vector3().setFromSphericalCoords(radius, polar, turn).add(centre);
  });

describe("joint rules", () => {
  test("fitSphere finds a sphere from a cap of it", () => {
    const centre = new Vector3(0.1, 0.9, -0.2);
    const cap = ball(centre).filter((point) => point.x < centre.x - 0.005);
    const fitted = fitSphere(cap);
    expect(fitted.centre.distanceTo(centre)).toBeLessThan(1e-6);
    expect(fitted.radius).toBeCloseTo(0.024, 6);
  });

  test("bandCentre is the middle of a bone's end", () => {
    const tibia = rod(new Vector3(0.09, 0.45, 0), new Vector3(0.09, 0.07, 0));
    expect(bandCentre(tibia, "bottom", 0.015).y).toBeCloseTo(0.075, 2);
    expect(bandCentre(tibia, "top", 0.02).x).toBeCloseTo(0.09, 2);
  });

  test("a leg and an arm of rods give back the joints they were built on", () => {
    const hip = new Vector3(0.09, 0.88, 0);
    const shoulder = new Vector3(0.18, 1.4, 0);
    const joints = limbJoints(
      {
        femur: [
          ...ball(hip),
          ...rod(new Vector3(0.12, 0.88, 0), new Vector3(0.1, 0.47, 0)),
        ],
        tibia: rod(new Vector3(0.09, 0.45, 0), new Vector3(0.09, 0.07, 0), 0.015),
        fibula: rod(new Vector3(0.12, 0.44, 0), new Vector3(0.12, 0.05, 0), 0.008),
        arm: {
          humerus: [
            ...ball(shoulder),
            ...rod(new Vector3(0.2, 1.38, 0), new Vector3(0.2, 1.1, 0)),
          ],
          radius: rod(
            new Vector3(0.215, 1.08, 0.01),
            new Vector3(0.235, 0.84, 0.01),
            0.01,
          ),
          ulna: rod(new Vector3(0.2, 1.1, 0), new Vector3(0.22, 0.84, 0), 0.01),
        },
      },
      "L",
      1,
    );
    expect(joints.hip.distanceTo(hip)).toBeLessThan(0.003);
    expect(joints.knee.y).toBeCloseTo(0.46, 1);
    expect(joints.ankle.y).toBeCloseTo(0.065, 1);
    expect(joints.arm?.shoulder.distanceTo(shoulder)).toBeLessThan(0.003);
    expect(joints.arm?.wrist.y).toBeCloseTo(0.845, 1);
    expect(headCentre(ball(hip), "L", 1).distanceTo(hip)).toBeLessThan(0.003);
  });

  test("armFromSkin puts elbow and wrist in the middle of an arm held out", () => {
    const neck = new Vector3(0, 1.5, 0);
    const arm = rod(new Vector3(0.16, 1.35, 0), new Vector3(0.6, 0.9, 0), 0.04, 4000);
    const { shoulder, elbow, wrist } = armFromSkin(neck, arm, "L", 1.7);
    expect(shoulder.x).toBeCloseTo(0.16, 2);
    const offLine = (point: Vector3): number =>
      Math.abs(point.y - (1.35 - ((point.x - 0.16) * 0.45) / 0.44));
    expect(offLine(elbow)).toBeLessThan(0.02);
    expect(offLine(wrist)).toBeLessThan(0.02);
    expect(wrist.x).toBeGreaterThan(elbow.x);
  });

  test("looseParts splits a mesh into its connected pieces, largest first", () => {
    // Two triangles sharing an edge, and one on its own.
    expect(looseParts([0, 1, 2, 1, 2, 3, 4, 5, 6], 7)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6],
    ]);
  });
});
