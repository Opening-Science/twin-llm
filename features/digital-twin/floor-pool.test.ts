import { describe, expect, test } from "bun:test";
import { Box3, Vector3 } from "three";

import { FLOOR_POOL_DROP_M, floorPoolPlacement, floorPoolTint } from "./floor-pool";

describe("floor pool", () => {
  test("sits 3 mm under the feet, centred under the body, sized from its footprint", () => {
    const box = new Box3(new Vector3(-0.5, -0.2, 0), new Vector3(0.5, 0.22, 1.87));
    const placement = floorPoolPlacement(box);
    expect(FLOOR_POOL_DROP_M).toBe(0.003);
    expect(placement?.x).toBe(0);
    expect(placement?.y).toBeCloseTo(0.01, 9);
    expect(placement?.z).toBe(-0.003);
    expect(placement?.radius).toBeCloseTo(0.8, 9);
  });

  test("an empty box places nothing", () => {
    expect(floorPoolPlacement(new Box3())).toBeNull();
  });

  test("tint follows the theme", () => {
    expect(floorPoolTint(true)).toEqual({ color: 0x000000, opacity: 0.55 });
    expect(floorPoolTint(false)).toEqual({ color: 0x334155, opacity: 0.22 });
  });
});
