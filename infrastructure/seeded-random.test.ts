import { describe, expect, test } from "bun:test";

import { hash32, mulberry32, normal, pick, randomFor } from "./seeded-random";

describe("seeded random", () => {
  test("mulberry32 gives the same numbers for the same seed", () => {
    const random = mulberry32(42);
    expect([random(), random()]).toEqual([0.6011037519201636, 0.44829055899754167]);
  });

  test("randomFor joins seed and key through hash32", () => {
    expect(randomFor(7, "rr")()).toBe(mulberry32(hash32("7:rr"))());
  });

  test("normal uses two draws: √(−2 ln 0.6011…) · cos(2π · 0.4482…) ≈ −0.95616", () => {
    expect(normal(mulberry32(42))).toBeCloseTo(-0.95616, 4);
  });

  test("pick takes the element the draw lands on", () => {
    expect(pick(() => 0.5, ["a", "b", "c"])).toBe("b");
  });
});
