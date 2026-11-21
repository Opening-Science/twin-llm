import { describe, expect, test } from "bun:test";
import { Group, Object3D } from "three";

import { createGlucoseDensityController } from "./glucose-density-control";

const particle = (rank: number) => {
  const node = new Object3D();
  node.name = `GlucoseParticle_${String(rank).padStart(3, "0")}`;
  node.userData.glucoseDensityRank = rank;
  return node;
};

describe("createGlucoseDensityController", () => {
  test("sets visibility by rank, regardless of traversal order", () => {
    const root = new Group();
    const pool = Array.from({ length: 180 }, (_, rank) => particle(rank));
    const unrelated = new Object3D();
    root.add(...pool.slice().reverse(), unrelated);
    const controller = createGlucoseDensityController(root);
    expect(controller.maxParticles).toBe(180);
    for (const [density, count] of [
      [0, 0],
      [0.5, 90],
      [1, 180],
      [0.25, 45],
    ] as const) {
      expect(controller.setDensity(density)).toBe(count);
      expect(pool.filter((node) => node.visible)).toEqual(pool.slice(0, count));
    }
    expect(unrelated.visible).toBe(true);
    for (const density of [-1, 1.01, Infinity, NaN]) {
      expect(() => controller.setDensity(density)).toThrow(RangeError);
    }
  });

  test("rejects incomplete or inconsistent particle pools", () => {
    expect(() => createGlucoseDensityController(new Group())).toThrow(
      "No density-enabled",
    );
    for (const ranks of [
      [0, 2],
      [0, 0],
    ]) {
      const root = new Group().add(...ranks.map(particle));
      expect(() => createGlucoseDensityController(root)).toThrow(
        "incomplete or has duplicate",
      );
    }
    const node = particle(0);
    node.userData.glucoseDensityCount = 2;
    expect(() => createGlucoseDensityController(node)).toThrow("incomplete");
    node.userData.glucoseDensityRank = 1;
    expect(() => createGlucoseDensityController(node)).toThrow("Conflicting");
  });
});
