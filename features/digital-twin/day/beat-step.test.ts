import { describe, expect, test } from "bun:test";

import { keyStep, stepBeat } from "./beat-step";

describe("stepBeat", () => {
  test("from nothing, next starts the day and previous ends it", () => {
    expect(stepBeat(null, 5, "next")).toBe(0);
    expect(stepBeat(null, 5, "previous")).toBe(4);
  });

  test("moves one beat and stops at the ends", () => {
    expect(stepBeat(2, 5, "next")).toBe(3);
    expect(stepBeat(2, 5, "previous")).toBe(1);
    expect(stepBeat(4, 5, "next")).toBe(4);
    expect(stepBeat(0, 5, "previous")).toBe(0);
  });

  test("first and last", () => {
    expect(stepBeat(2, 5, "first")).toBe(0);
    expect(stepBeat(2, 5, "last")).toBe(4);
  });

  test("a day without beats has nothing to step to", () => {
    expect(stepBeat(null, 0, "next")).toBeNull();
  });
});

describe("keyStep", () => {
  test("arrows, Home and End step; other keys do not", () => {
    expect(keyStep("ArrowDown")).toBe("next");
    expect(keyStep("ArrowUp")).toBe("previous");
    expect(keyStep("Home")).toBe("first");
    expect(keyStep("End")).toBe("last");
    expect(keyStep("Enter")).toBeNull();
    expect(keyStep("Tab")).toBeNull();
  });
});
