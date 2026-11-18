import { describe, expect, test } from "bun:test";
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from "three";

import { heartVertexMask, heartWorldBox, isHeartHit } from "./heart-geometry";

const taggedHeart = () => {
  const root = new Group();
  root.userData.structures = [
    { system: "cardiovascular", ontologyid: "FMA:9553" },
    { system: "cardiovascular", ontologyid: "FMA:4712" },
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        -0.05, 1.2, 0, 0.05, 1.2, 0, 0, 1.3, 0.05, -0.3, 0, 0, 0.3, 0, 0, 0, 1.8, 0,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    "_structure",
    new BufferAttribute(new Uint16Array([0, 0, 0, 1, 1, 1]), 1),
  );
  const mesh = new Mesh(geometry);
  root.add(mesh);
  return { root, mesh };
};

describe("heart geometry for picking and focusing", () => {
  test("BodyParts3D heart triangles focus; coronary vessels and mixed triangles do not", () => {
    const { mesh } = taggedHeart();
    const part = { mesh, group: null, system: "cardiovascular" };
    expect([...heartVertexMask(mesh)!]).toEqual([1, 1, 1, 0, 0, 0]);
    expect(isHeartHit(part, { a: 0, b: 1, c: 2 })).toBe(true);
    expect(isHeartHit(part, { a: 3, b: 4, c: 5 })).toBe(false);
    expect(isHeartHit(part, { a: 0, b: 1, c: 3 })).toBe(false);
    expect(isHeartHit(part, null)).toBe(false);
    expect(isHeartHit({ ...part, system: "respiratory" }, { a: 0, b: 1, c: 2 })).toBe(
      false,
    );
  });

  test("HRA recognizes its heart group without BodyParts3D tagging", () => {
    const mesh = new Mesh();
    expect(isHeartHit({ mesh, group: "heart", system: "cardiovascular" }, null)).toBe(
      true,
    );
    expect(
      isHeartHit({ mesh, group: "bloodvasculature", system: "cardiovascular" }, null),
    ).toBe(false);
  });

  test("focus bounds contain only the heart, including the atlas placement transform", () => {
    const { root, mesh } = taggedHeart();
    root.rotation.x = Math.PI / 2;
    root.position.set(1, 2, 3);
    mesh.scale.setScalar(2);
    const box = heartWorldBox(mesh, true)!;
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(0.2, 6);
    expect(size.y).toBeCloseTo(0.1, 6);
    expect(size.z).toBeCloseTo(0.2, 6);
    expect(box.getCenter(new Vector3()).toArray()).toEqual([
      1,
      expect.closeTo(1.95, 6),
      expect.closeTo(5.5, 6),
    ]);
    expect(heartWorldBox(mesh, false)!.getSize(new Vector3()).z).toBeGreaterThan(3);
  });
});
