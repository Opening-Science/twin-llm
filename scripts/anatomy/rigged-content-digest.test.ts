import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { canonicalQuaternion, riggedCanonicalContent } from "./rigged-content-digest";
import { type Body, BODY, buildGlb, SPINE } from "./rigged-glb-fixture";

const digest = (glb: Uint8Array): string | null => {
  const content = riggedCanonicalContent(glb);
  return content === null ? null : createHash("sha256").update(content).digest("hex");
};

describe("riggedCanonicalContent", () => {
  test("ignores the sign of zero and the last bits of a renormalised quaternion", () => {
    const encodedElsewhere: Body = {
      ...BODY,
      positions: BODY.positions.map((value) => (value === 0 ? -0 : value)),
      bones: [
        {
          name: "root",
          translation: [-0, 1.02902, -0],
          rotation: [-0.7071067811865475, -0, -0, 0.7071067811865477],
        },
        SPINE,
      ],
    };
    const a = buildGlb(BODY);
    const b = buildGlb(encodedElsewhere);
    expect(createHash("sha256").update(a).digest("hex")).not.toBe(
      createHash("sha256").update(b).digest("hex"),
    );
    expect(digest(b)).toBe(digest(a));
  });

  test("changes when the body changes by one step of its grid", () => {
    const base = digest(buildGlb(BODY));
    const moved = digest(
      buildGlb({
        ...BODY,
        positions: BODY.positions.map((v, i) => (i === 1 ? v + 1e-5 : v)),
      }),
    );
    const reweighted = digest(
      buildGlb({
        ...BODY,
        weights: BODY.weights.map((v, i) => (i === 4 ? 127 : i === 5 ? 128 : v)),
      }),
    );
    const renamed = digest(
      buildGlb({
        ...BODY,
        bones: BODY.bones.map((bone) => ({ ...bone, name: `${bone.name}x` })),
      }),
    );
    expect(new Set([base, moved, reweighted, renamed]).size).toBe(4);
  });

  test("is null for anything that is not a rigged body GLB", () => {
    expect(riggedCanonicalContent(new Uint8Array([1, 2, 3]))).toBeNull();
    const glb = buildGlb(BODY);
    expect(riggedCanonicalContent(glb.subarray(0, glb.byteLength - 8))).toBeNull();
  });
});

describe("canonicalQuaternion", () => {
  test("rounds to 1e-7 and keeps w positive, or the first non-zero part when w is 0", () => {
    expect(canonicalQuaternion([0.1, 0.2, 0.3, -0.9])).toEqual([
      -1_000_000, -2_000_000, -3_000_000, 9_000_000,
    ]);
    expect(canonicalQuaternion([-1, 0, 0, 0])).toEqual([10_000_000, 0, 0, 0]);
    expect(Object.is(canonicalQuaternion([-0, 0, 0, 1])[0], 0)).toBe(true);
  });
});
