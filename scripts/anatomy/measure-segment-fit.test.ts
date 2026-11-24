import { describe, expect, test } from "bun:test";

import { anatomyDir, filesPresent, measureSegmentFit } from "./measure-segment-fit";

/**
 * The segment fit on the real pinned BodyParts3D atlas and both rigged demo
 * bodies. Skipped when the files are absent, as in CI: they are fetched,
 * not committed (`bun run anatomy:fetch`). CI covers the same rules on the
 * synthetic figures (`packages/anatomy/segments.test.ts`,
 * `features/digital-twin/anatomy/skinned-atlas.test.ts`). The full tables,
 * all three atlases, come from `bun scripts/anatomy/measure-segment-fit.ts`.
 * BodyParts3D only, because the HRA atlases have no skull, hands or feet.
 */
const dir = anatomyDir();
const present = filesPresent(dir, ["bodyparts3d"]);
const SLOW = 120_000;

describe.skipIf(!present)("the segment fit on the pinned files", () => {
  const measured = present
    ? measureSegmentFit(dir, ["bodyparts3d"])
    : Promise.resolve([]);

  test(
    "the fitted skeleton stands as tall as each body, and the two as tall as each other",
    async () => {
      const [male, female] = await measured;
      expect(male!.ok).toBe(true);
      expect(female!.ok).toBe(true);
      expect(Math.abs(male!.skeletonHeight.after - 1)).toBeLessThan(0.01);
      expect(Math.abs(female!.skeletonHeight.after - 1)).toBeLessThan(0.01);
      const skeletons =
        (male!.skeletonHeight.after * male!.bodyHeight) /
        (female!.skeletonHeight.after * female!.bodyHeight);
      expect(
        Math.abs(skeletons / (male!.bodyHeight / female!.bodyHeight) - 1),
      ).toBeLessThan(0.01);
    },
    SLOW,
  );

  // Not met yet (77 to 78 % of hand bones, 71 to 77 % of foot bones; see
  // docs/anatomy.md). Marked failing so it turns up the day it passes.
  test.failing(
    "98 % of hand and foot bones lie inside the skin",
    async () => {
      for (const pair of await measured) {
        expect(pair.inside.hands.after).toBeGreaterThanOrEqual(98);
        expect(pair.inside.feet.after).toBeGreaterThanOrEqual(98);
      }
    },
    SLOW,
  );
});
