import { describe, expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";

import { disposeObject3D } from "./dispose-object";

const counting = <
  T extends { addEventListener: (type: "dispose", fn: () => void) => void },
>(
  item: T,
  counter: { count: number },
): T => {
  item.addEventListener("dispose", () => {
    Object.assign(counter, { count: counter.count + 1 });
  });
  return item;
};

describe("disposeObject3D", () => {
  test("disposes each geometry, each shared material and its texture exactly once", () => {
    const geometries = { count: 0 };
    const materials = { count: 0 };
    const textures = { count: 0 };
    const map = counting(new Texture(), textures);
    const shared = counting(new MeshStandardMaterial({ map }), materials);
    const root = new Group();
    const child = new Group();
    root.add(new Mesh(counting(new BoxGeometry(), geometries), shared));
    child.add(new Mesh(counting(new BoxGeometry(), geometries), shared));
    child.add(
      new Mesh(counting(new BoxGeometry(), geometries), [
        counting(new MeshStandardMaterial(), materials),
        shared,
      ]),
    );
    root.add(child);

    disposeObject3D(root);

    expect(geometries.count).toBe(3);
    expect(materials.count).toBe(2);
    expect(textures.count).toBe(1);
  });
});
