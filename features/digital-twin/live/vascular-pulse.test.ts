import { describe, expect, spyOn, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";

import {
  setVascularPulse,
  VASCULAR_HEART_CONTRACTION,
  VESSEL_EXPANSION_M,
} from "./vascular-pulse";

const fixture = () => {
  const root = new Group();
  root.userData.structures = [
    { system: "cardiovascular", ontologyid: "FMA:9553" },
    // A coronary vein is still a vessel, despite its name referring to a ventricle.
    { system: "cardiovascular", ontologyid: "FMA:4712" },
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        -0.05, 1.3, 0, 0.05, 1.3, 0, -0.003, 1, 0, 0.003, 1, 0, -0.203, 0.3, 0, -0.197,
        0.3, 0,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(
      new Float32Array([-1, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0]),
      3,
    ),
  );
  geometry.setAttribute(
    "_structure",
    new BufferAttribute(new Uint16Array([0, 0, 1, 1, 1, 1]), 1),
  );
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  root.add(mesh);
  return { root, mesh, geometry };
};

describe("BodyParts3D vascular pulse", () => {
  test("heart contraction is 4%, with vessels stationary during the heart pulse", () => {
    const { mesh, root, geometry } = fixture();
    const before = geometry.getAttribute("position");
    const rest = Array.from(before.array);
    expect(setVascularPulse(mesh, root, { heart: 1, vessels: 0 })).toBe(true);
    const after = geometry.getAttribute("position");
    expect(VASCULAR_HEART_CONTRACTION).toBe(0.04);
    expect(after.getX(0)).toBeCloseTo(before.getX(0) * 0.96, 8);
    expect(after.getX(1)).toBeCloseTo(before.getX(1) * 0.96, 8);
    expect(Array.from(after.array).slice(6)).toEqual(rest.slice(6));
    expect(Array.from(before.array)).toEqual(rest);
  });

  test("all vessel surfaces expand by at most 0.02 mm together, without moving their centres", () => {
    const { mesh, root, geometry } = fixture();
    const before = geometry.getAttribute("position");
    expect(VESSEL_EXPANSION_M).toBe(0.00002);
    for (const amount of [0.25, 0.5, 1]) {
      setVascularPulse(mesh, root, { heart: 0, vessels: amount });
      const after = geometry.getAttribute("position");
      for (const left of [2, 4]) {
        // Float32 positions around 0.2 m have about 15 nm spacing.
        expect(before.getX(left) - after.getX(left)).toBeCloseTo(0.00002 * amount, 7);
        expect(after.getX(left + 1) - before.getX(left + 1)).toBeCloseTo(
          0.00002 * amount,
          7,
        );
        expect(after.getX(left) + after.getX(left + 1)).toBeCloseTo(
          before.getX(left) + before.getX(left + 1),
          7,
        );
      }
      for (let i = 0; i < before.count; i += 1) {
        expect(after.getY(i)).toBe(before.getY(i));
        expect(after.getZ(i)).toBe(before.getZ(i));
      }
      expect(after.getX(0)).toBe(before.getX(0));
      expect(after.getX(1)).toBe(before.getX(1));
    }
  });

  test("normal displacement accounts for the mesh transform in atlas metres", () => {
    const { mesh, root, geometry } = fixture();
    root.rotation.x = Math.PI / 2;
    root.scale.setScalar(1.2);
    mesh.scale.set(0.5, 0.8, 0.6);
    const before = geometry.getAttribute("position");
    setVascularPulse(mesh, root, { heart: 0, vessels: 1 });
    const after = geometry.getAttribute("position");
    expect((after.getX(3) - before.getX(3)) * 0.5).toBeCloseTo(VESSEL_EXPANSION_M, 9);
  });

  test("repeated beats do not accumulate; stopping restores positions and bounds exactly", () => {
    const { mesh, root, geometry } = fixture();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const original = geometry.getAttribute("position");
    const box = geometry.boundingBox;
    const sphere = geometry.boundingSphere;
    for (let beat = 0; beat < 100; beat += 1) {
      setVascularPulse(mesh, root, { heart: 1, vessels: 0.5 });
      setVascularPulse(mesh, root, { heart: 0, vessels: 0 });
      expect(Array.from(geometry.getAttribute("position").array)).toEqual(
        Array.from(original.array),
      );
    }
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(sphere!.radius);
    setVascularPulse(mesh, root, null);
    expect(geometry.getAttribute("position")).toBe(original);
    expect(geometry.boundingBox).toBe(box);
    expect(geometry.boundingSphere).toBe(sphere);
    expect(setVascularPulse(mesh, root, { heart: 0, vessels: 1 })).toBe(true);
  });

  test("missing or invalid anatomy tags disable deformation and warn once, rather than guessing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { mesh, root, geometry } = fixture();
      const original = geometry.getAttribute("position");
      geometry.deleteAttribute("_structure");
      expect(setVascularPulse(mesh, root, { heart: 1, vessels: 1 })).toBe(false);
      expect(setVascularPulse(mesh, root, { heart: 1, vessels: 1 })).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(geometry.getAttribute("position")).toBe(original);
      const invalid = fixture();
      invalid.geometry.getAttribute("_structure").setX(0, 999);
      expect(setVascularPulse(invalid.mesh, invalid.root, { heart: 1, vessels: 1 })).toBe(
        false,
      );
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
