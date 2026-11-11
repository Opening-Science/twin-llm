import { describe, expect, test } from "bun:test";
import { Box3, Vector3 } from "three";

import { FRAMING_MARGIN, spreadBox, threeQuarterFraming } from "./framing";

/** A CT trunk placed in a 1.91 m body: 30 cm wide, 23 cm deep, 61 cm tall. */
const TRUNK = new Box3(new Vector3(-0.15, -0.12, 0.85), new Vector3(0.15, 0.11, 1.46));

describe("threeQuarterFraming", () => {
  test("looks at the box centre from the front, turned 35° to the body's left, a little above", () => {
    const framing = threeQuarterFraming(TRUNK, 40, 1.4)!;
    expect(framing.target.toArray().map((n) => Math.round(n * 1e4) / 1e4)).toEqual([
      0, -0.005, 1.155,
    ]);
    const view = framing.position.clone().sub(framing.target).normalize();
    expect(view.y).toBeLessThan(-0.8);
    expect(view.x).toBeCloseTo(
      Math.sin((35 * Math.PI) / 180) * Math.cos(Math.PI / 18),
      6,
    );
    expect(view.z).toBeCloseTo(Math.sin(Math.PI / 18), 6);
  });

  test("the bounding sphere fills the narrower field of view, with the margin", () => {
    const radius = TRUNK.getSize(new Vector3()).length() / 2;
    const tall = threeQuarterFraming(TRUNK, 40, 1.4)!;
    const tallDistance = tall.position.distanceTo(tall.target);
    expect(tallDistance).toBeCloseTo(
      (radius * FRAMING_MARGIN) / Math.sin(Math.PI / 9),
      6,
    );
    // A narrow canvas (aspect 0.5) is limited by its width, so the camera steps back.
    const narrow = threeQuarterFraming(TRUNK, 40, 0.5)!;
    expect(narrow.position.distanceTo(narrow.target)).toBeGreaterThan(tallDistance);
  });

  test("a closer view than the whole body: the trunk is framed from under 2 m", () => {
    const framing = threeQuarterFraming(TRUNK, 40, 1.4)!;
    expect(framing.position.distanceTo(framing.target)).toBeLessThan(2);
    expect(framing.near).toBeGreaterThan(0);
    expect(framing.far).toBeGreaterThan(framing.position.distanceTo(framing.target));
  });

  test("a kept direction only moves the camera in or out", () => {
    const side = new Vector3(1, 0, 0);
    const framing = threeQuarterFraming(TRUNK, 40, 1.4, side)!;
    const view = framing.position.clone().sub(framing.target).normalize();
    expect(view.toArray()).toEqual([1, 0, 0]);
  });

  test("an empty box or a broken camera frames nothing", () => {
    expect(threeQuarterFraming(new Box3(), 40, 1.4)).toBeNull();
    expect(threeQuarterFraming(TRUNK, 0, 1.4)).toBeNull();
    expect(threeQuarterFraming(TRUNK, 40, Number.NaN)).toBeNull();
  });
});

describe("spreadBox", () => {
  const round = (v: Vector3) => v.toArray().map((n) => Math.round(n * 1e4) / 1e4);

  test("together, the box is unchanged", () => {
    expect(spreadBox(TRUNK, 0)).toBe(TRUNK);
  });

  test("fully spread: 1.8 times the size plus 2 cm each side, about the same middle", () => {
    const spread = spreadBox(TRUNK, 1);
    expect(round(spread.getSize(new Vector3()))).toEqual([0.58, 0.454, 1.138]);
    expect(round(spread.getCenter(new Vector3()))).toEqual(
      round(TRUNK.getCenter(new Vector3())),
    );
  });

  test("the camera steps back as the bones spread", () => {
    const together = threeQuarterFraming(TRUNK, 40, 1.4)!;
    const apart = threeQuarterFraming(spreadBox(TRUNK, 1), 40, 1.4)!;
    expect(apart.position.distanceTo(apart.target)).toBeGreaterThan(
      together.position.distanceTo(together.target) * 1.7,
    );
  });
});
