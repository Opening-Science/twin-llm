import { describe, expect, test } from "bun:test";

import {
  applyMask,
  dampDepth,
  depthPosition,
  layerMix,
  snapDepth,
  stepStop,
  type LayerId,
} from "./layers";

const state = (layer: LayerId, depth: number): string => {
  const mix = layerMix(layer, depth);
  if (!mix.visible) return "hidden";
  if (mix.fade > 0.999) return "glass";
  if (mix.fade < 0.001 && mix.alpha > 0.999) return "solid";
  return `partial(${mix.alpha.toFixed(2)},${mix.fade.toFixed(2)})`;
};

describe("layerMix stop table", () => {
  test.each([
    [0, ["solid", "hidden", "hidden", "hidden"]],
    [1, ["glass", "solid", "solid", "hidden"]],
    [2, ["glass", "glass", "solid", "hidden"]],
    [3, ["glass", "hidden", "glass", "solid"]],
  ])("depth %d", (depth, expected) => {
    expect(
      (["scan", "muscle", "skeleton", "organs"] as const).map((layer) =>
        state(layer, depth),
      ),
    ).toEqual(expected);
  });

  test("depth outside 0..3 is clamped", () => {
    expect(layerMix("organs", 7)).toEqual(layerMix("organs", 3));
    expect(layerMix("scan", -2)).toEqual(layerMix("scan", 0));
  });

  test("a small depth change gives a small change in every layer", () => {
    for (let d = 0; d < 3; d += 0.05) {
      for (const layer of ["scan", "muscle", "skeleton", "organs"] as const) {
        const a = layerMix(layer, d);
        const b = layerMix(layer, d + 0.01);
        expect(Math.abs(a.alpha - b.alpha)).toBeLessThan(0.04);
        expect(Math.abs(a.fade - b.fade)).toBeLessThan(0.04);
      }
    }
  });

  test("halfway between muscle and skeleton", () => {
    const muscle = layerMix("muscle", 1.5);
    expect(muscle.fade).toBeCloseTo(0.5, 6);
    expect(muscle.alpha).toBe(1);
    expect(layerMix("skeleton", 1.5)).toEqual({ alpha: 1, fade: 0, visible: true });
  });
});

describe("applyMask", () => {
  test("a hidden toggle hides without changing alpha or fade", () => {
    const mix = layerMix("muscle", 1);
    expect(applyMask(mix, false)).toEqual({ ...mix, visible: false });
    expect(applyMask(mix, true)).toBe(mix);
  });
});

describe("dampDepth", () => {
  test("approaches the target and snaps once close", () => {
    expect(dampDepth(0, 2, 0.02, false)).toBeCloseTo(2 - 2 * Math.exp(-0.14), 9);
    expect(dampDepth(1.9995, 2, 0.016, false)).toBe(2);
  });

  test("a long frame after idle is clamped to one 30 fps step", () => {
    expect(dampDepth(0, 2, 5, false)).toBeCloseTo(2 - 2 * Math.exp(-7 / 30), 9);
  });

  test("reduced motion jumps straight to the target", () => {
    expect(dampDepth(0, 3, 0.016, true)).toBe(3);
  });
});

describe("stops", () => {
  test("snapDepth snaps within 0.12 and leaves other values", () => {
    expect(snapDepth(1.1)).toBe(1);
    expect(snapDepth(2.88)).toBe(3);
    expect(snapDepth(1.5)).toBe(1.5);
  });

  test("stepStop moves to the next stop and clamps at the ends", () => {
    expect(stepStop(0, 1)).toBe(1);
    expect(stepStop(1.4, 1)).toBe(2);
    expect(stepStop(1.4, -1)).toBe(1);
    expect(stepStop(1, -1)).toBe(0);
    expect(stepStop(3, 1)).toBe(3);
    expect(stepStop(0, -1)).toBe(0);
  });

  test("depthPosition names the stop or the two neighbours", () => {
    expect(depthPosition(2)).toEqual({ exact: "skeleton" });
    expect(depthPosition(1.5)).toEqual({ between: ["muscle", "skeleton"] });
    expect(depthPosition(0.3)).toEqual({ between: ["scan", "muscle"] });
  });
});
