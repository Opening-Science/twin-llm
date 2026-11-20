import { describe, expect, spyOn, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";

import { setVascularPulse, VASCULAR_HEART_CONTRACTION } from "./vascular-pulse";

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
    "_structure",
    new BufferAttribute(new Uint16Array([0, 0, 1, 1, 1, 1]), 1),
  );
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  root.add(mesh);
  return { mesh, geometry };
};

describe("BodyParts3D vascular pulse", () => {
  test("heart contraction is 4%, with vessels stationary during the heart pulse", () => {
    const { mesh, geometry } = fixture();
    const before = geometry.getAttribute("position");
    const rest = Array.from(before.array);
    expect(setVascularPulse(mesh, 1)).toBe(true);
    const after = geometry.getAttribute("position");
    expect(VASCULAR_HEART_CONTRACTION).toBe(0.04);
    expect(after.getX(0)).toBeCloseTo(before.getX(0) * 0.96, 8);
    expect(after.getX(1)).toBeCloseTo(before.getX(1) * 0.96, 8);
    expect(Array.from(after.array).slice(6)).toEqual(rest.slice(6));
    expect(Array.from(before.array)).toEqual(rest);
  });

  test("each frame marks only contiguous heart ranges for GPU upload", () => {
    const { mesh, geometry } = fixture();
    geometry.getAttribute("_structure").setX(4, 0);
    const rest = geometry.getAttribute("position");
    for (const amount of [0.25, 0.5, 1]) {
      expect(setVascularPulse(mesh, amount)).toBe(true);
      const positions = geometry.getAttribute("position");
      expect(positions).toBeInstanceOf(BufferAttribute);
      if (!(positions instanceof BufferAttribute))
        throw new Error("Missing pulse buffer");
      expect(positions.updateRanges).toEqual([
        { start: 0, count: 6 },
        { start: 12, count: 3 },
      ]);
      for (const vertex of [2, 3, 5]) {
        expect(positions.getX(vertex)).toBe(rest.getX(vertex));
        expect(positions.getY(vertex)).toBe(rest.getY(vertex));
        expect(positions.getZ(vertex)).toBe(rest.getZ(vertex));
      }
    }
  });

  test("repeated beats do not accumulate; stopping restores positions and bounds exactly", () => {
    const { mesh, geometry } = fixture();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const original = geometry.getAttribute("position");
    const box = geometry.boundingBox;
    const sphere = geometry.boundingSphere;
    for (let beat = 0; beat < 100; beat += 1) {
      setVascularPulse(mesh, 1);
      setVascularPulse(mesh, 0);
      expect(Array.from(geometry.getAttribute("position").array)).toEqual(
        Array.from(original.array),
      );
    }
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(sphere!.radius);
    setVascularPulse(mesh, null);
    expect(geometry.getAttribute("position")).toBe(original);
    expect(geometry.boundingBox).toBe(box);
    expect(geometry.boundingSphere).toBe(sphere);
    expect(setVascularPulse(mesh, 1)).toBe(true);
  });

  test("missing or invalid anatomy tags disable deformation and warn once, rather than guessing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { mesh, geometry } = fixture();
      const original = geometry.getAttribute("position");
      geometry.deleteAttribute("_structure");
      expect(setVascularPulse(mesh, 1)).toBe(false);
      expect(setVascularPulse(mesh, 1)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(geometry.getAttribute("position")).toBe(original);
      const invalid = fixture();
      invalid.geometry.getAttribute("_structure").setX(0, 999);
      expect(setVascularPulse(invalid.mesh, 1)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
