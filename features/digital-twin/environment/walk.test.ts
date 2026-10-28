import { describe, expect, test } from "bun:test";

import {
  clampToRadius,
  isTypingTarget,
  isWalkCode,
  MAX_WALK_DT_S,
  walkKeyApplies,
  type KeyTarget,
  type WalkKey,
  WALK_RADIUS_M,
  WALK_SPEED_M_S,
  walkIntent,
  walkStep,
  type WalkPose,
} from "./walk";

/** The fitted view: camera in front of the body (it faces -Y), looking at +Y. */
const FRONT: WalkPose = { position: [0, -3, 1], target: [0, 0, 1] };
const CENTER = [0, 0] as const;

const close = (pose: WalkPose, expected: WalkPose) => {
  pose.position.forEach((value, i) =>
    expect(value).toBeCloseTo(expected.position[i]!, 10),
  );
  pose.target.forEach((value, i) => expect(value).toBeCloseTo(expected.target[i]!, 10));
};

describe("walk keys", () => {
  test("WASD by code and the arrow keys; nothing else", () => {
    expect(
      ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"].every(isWalkCode),
    ).toBe(true);
    expect(isWalkCode("KeyQ")).toBe(false);
    expect(isWalkCode("Space")).toBe(false);
  });

  test("held keys add up and opposite keys cancel", () => {
    expect(walkIntent(["KeyW"])).toEqual({ forward: 1, right: 0 });
    expect(walkIntent(["KeyW", "ArrowUp"])).toEqual({ forward: 1, right: 0 });
    expect(walkIntent(["KeyW", "KeyS"])).toEqual({ forward: 0, right: 0 });
    expect(walkIntent(["KeyS", "KeyD"])).toEqual({ forward: -1, right: 1 });
    expect(walkIntent(["KeyQ"])).toEqual({ forward: 0, right: 0 });
  });
});

describe("walkStep", () => {
  test("forward moves camera and target together towards where the camera looks", () => {
    expect(WALK_SPEED_M_S).toBe(1.4);
    close(
      walkStep({
        pose: FRONT,
        intent: { forward: 1, right: 0 },
        dt: 0.05,
        center: CENTER,
      }),
      {
        position: [0, -2.93, 1],
        target: [0, 0.07, 1],
      },
    );
  });

  test("right is forward × up: +X when looking along +Y", () => {
    close(
      walkStep({
        pose: FRONT,
        intent: { forward: 0, right: 1 },
        dt: 0.05,
        center: CENTER,
      }),
      {
        position: [0.07, -3, 1],
        target: [0.07, 0, 1],
      },
    );
  });

  test("a diagonal is no faster than a straight line", () => {
    const side = 0.07 / Math.SQRT2;
    close(
      walkStep({
        pose: FRONT,
        intent: { forward: 1, right: 1 },
        dt: 0.05,
        center: CENTER,
      }),
      {
        position: [side, -3 + side, 1],
        target: [side, side, 1],
      },
    );
  });

  test("a long pause is one short step, and no intent is no step", () => {
    expect(MAX_WALK_DT_S).toBe(0.1);
    close(
      walkStep({ pose: FRONT, intent: { forward: 1, right: 0 }, dt: 2, center: CENTER }),
      {
        position: [0, -2.86, 1],
        target: [0, 0.14, 1],
      },
    );
    expect(
      walkStep({
        pose: FRONT,
        intent: { forward: 0, right: 0 },
        dt: 0.05,
        center: CENTER,
      }),
    ).toBe(FRONT);
  });

  test("the target stops at the walk radius and the camera keeps its offset", () => {
    expect(WALK_RADIUS_M).toBe(8);
    const edge: WalkPose = { position: [7.95, -3, 1], target: [7.95, 0, 1] };
    close(
      walkStep({ pose: edge, intent: { forward: 0, right: 1 }, dt: 0.1, center: CENTER }),
      {
        position: [8, -3, 1],
        target: [8, 0, 1],
      },
    );
  });

  test("height never changes, and straight down falls back to +Y", () => {
    const down: WalkPose = { position: [1, 1, 5], target: [1, 1, 0] };
    close(
      walkStep({
        pose: down,
        intent: { forward: 1, right: 0 },
        dt: 0.05,
        center: CENTER,
      }),
      {
        position: [1, 1.07, 5],
        target: [1, 1.07, 0],
      },
    );
  });
});

describe("clampToRadius", () => {
  test("inside is unchanged; outside is pulled onto the circle", () => {
    expect(clampToRadius([3, 4], [0, 0], 8)).toEqual([3, 4]);
    expect(clampToRadius([6, 8], [0, 0], 5)).toEqual([3, 4]);
    expect(clampToRadius([11, 1], [1, 1], 5)).toEqual([6, 1]);
  });
});

const element = (tagName: string, role: string | null = null, editable = false) =>
  ({
    tagName,
    isContentEditable: editable,
    getAttribute: (name: string) => (name === "role" ? role : null),
  }) satisfies KeyTarget;

describe("isTypingTarget", () => {
  test("fields and keyed widgets keep their keys; the page and buttons do not", () => {
    expect(
      [
        element("INPUT"),
        element("input"),
        element("TEXTAREA"),
        element("SELECT"),
        element("DIV", null, true),
        element("BUTTON", "tab"),
        element("DIV", "slider"),
        element("DIV", "listbox"),
        element("BODY"),
        element("BUTTON"),
        element("CANVAS"),
        element("DIV", "application"),
        null,
      ].map(isTypingTarget),
    ).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("walkKeyApplies", () => {
  const key = (overrides: Partial<WalkKey> = {}): WalkKey => ({
    code: "KeyW",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    typing: false,
    pointerOver: false,
    focusInside: false,
    ...overrides,
  });

  test("hovering the 3D view is enough, no click first", () => {
    expect(walkKeyApplies(key({ pointerOver: true }))).toBe(true);
    expect(walkKeyApplies(key({ code: "ArrowLeft", pointerOver: true }))).toBe(true);
  });

  test("focus on the view walks with the pointer elsewhere", () => {
    expect(walkKeyApplies(key({ focusInside: true }))).toBe(true);
  });

  test("neither hovered nor focused: the key is the page's", () => {
    expect(walkKeyApplies(key())).toBe(false);
  });

  test("typing in a field never walks, even over the view", () => {
    expect(walkKeyApplies(key({ typing: true, pointerOver: true }))).toBe(false);
    expect(walkKeyApplies(key({ typing: true, focusInside: true }))).toBe(false);
  });

  test("modifiers, used keys and other keys do not walk", () => {
    expect(
      [
        key({ pointerOver: true, ctrlKey: true }),
        key({ pointerOver: true, metaKey: true }),
        key({ pointerOver: true, altKey: true }),
        key({ pointerOver: true, defaultPrevented: true }),
        key({ pointerOver: true, code: "KeyQ" }),
        key({ pointerOver: true, code: "Space" }),
      ].map(walkKeyApplies),
    ).toEqual([false, false, false, false, false, false]);
  });
});
