import { describe, expect, test } from "bun:test";

import { kioskKeyStep, stepKioskBeat } from "./kiosk-play";

describe("stepKioskBeat", () => {
  test("starts on the first beat and goes on one at a time", () => {
    expect(stepKioskBeat(null, 3, "next")).toBe(0);
    expect(stepKioskBeat(0, 3, "next")).toBe(1);
    expect(stepKioskBeat(1, 3, "next")).toBe(2);
  });

  test("stays on the last beat rather than jumping back to the morning", () => {
    expect(stepKioskBeat(2, 3, "next")).toBe(2);
  });

  test("goes back one, and stops at the first", () => {
    expect(stepKioskBeat(2, 3, "previous")).toBe(1);
    expect(stepKioskBeat(0, 3, "previous")).toBe(0);
  });

  test("a day without beats has none to land on", () => {
    expect(stepKioskBeat(null, 0, "next")).toBeNull();
    expect(stepKioskBeat(0, 0, "previous")).toBeNull();
  });
});

describe("kioskKeyStep", () => {
  test("Space, Enter and the forward arrows go on; the back arrows go back", () => {
    expect(
      [" ", "Enter", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].map(kioskKeyStep),
    ).toEqual(["next", "next", "next", "next", "previous", "previous"]);
  });

  test("any other key does nothing", () => {
    expect(["a", "Escape", "Tab", "Home"].map(kioskKeyStep)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});
