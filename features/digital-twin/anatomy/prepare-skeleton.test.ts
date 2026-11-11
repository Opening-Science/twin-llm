import { describe, expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

import { parseSkeletonAtlas } from "@/packages/anatomy/open-skeleton";

import { layerFadeUniforms } from "./layer-material";
import { applyExplode, prepareSkeleton } from "./prepare-skeleton";

/** A box bone in body coordinates, named and tagged as open-anatomy's mesh.py does. */
const bone = (
  name: string,
  extras: Record<string, unknown>,
  centre: readonly [number, number, number],
  size = 0.04,
): Mesh => {
  const geometry = new BoxGeometry(size, size, size).translate(...centre);
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.name = name;
  mesh.userData = { system: "skeletal", licence: "CC-BY-4.0", ...extras };
  return mesh;
};

const ATLAS = parseSkeletonAtlas({
  case: "s0086",
  girdleLeftOut: [{ label: "clavicula_left", reason: "cut by the scan's edge" }],
});

const skeleton = () => {
  const root = new Group();
  root.add(
    bone("FMA_7485", { term: "FMA:7485", name: "sternum" }, [0, 0.2, 0.1]),
    bone("FMA_7987", { term: "FMA:7987", name: "left first rib" }, [0.1, 0.25, 0]),
    bone("FMA_7857", { term: "FMA:7857", name: "right first rib" }, [-0.1, 0.25, 0]),
    bone("FMA_16587", { term: "FMA:16587", name: "left hip bone" }, [0.1, -0.3, 0], 0.2),
    bone(
      "FMA_16586",
      { term: "FMA:16586", name: "right hip bone" },
      [-0.1, -0.3, 0],
      0.2,
    ),
    bone(
      "FMA_85213",
      { term: "FMA:85213", name: "set of costal cartilages", modelled: true },
      [0, 0.15, 0.12],
    ),
    // Not in today's files; atlas.json leaves it out, so it must never draw.
    bone("FMA_13322", { term: "FMA:13322", name: "left clavicle" }, [0.08, 0.35, 0.05]),
  );
  return root;
};

describe("prepareSkeleton", () => {
  test("names every bone, marks the modelled one and drops what atlas.json left out", () => {
    const root = skeleton();
    const prepared = prepareSkeleton(root, ATLAS);
    expect(prepared.parts.map((part) => [part.label, part.modelled])).toEqual([
      ["Sternum", false],
      ["Left first rib", false],
      ["Right first rib", false],
      ["Left hip bone", false],
      ["Right hip bone", false],
      ["Set of costal cartilages", true],
    ]);
    expect(root.children.map((child) => child.name)).not.toContain("FMA_13322");
    expect(prepared.parts[0]).toMatchObject({
      layer: "skeleton",
      system: "musculoskeletal",
      group: "fma_7485",
      name: "FMA_7485",
      ontologyId: "FMA:7485",
      ct: true,
    });
  });

  test("every bone fades on one shared set of skeleton uniforms", () => {
    const prepared = prepareSkeleton(skeleton(), ATLAS);
    for (const part of prepared.parts) {
      expect(layerFadeUniforms(part.mesh.material as MeshStandardMaterial)).toBe(
        prepared.uniforms,
      );
    }
  });

  test("the hip box spans both hip bones and anchors the fit", () => {
    const prepared = prepareSkeleton(skeleton(), ATLAS);
    const round = (values: readonly number[] = []) =>
      values.map((n) => Math.round(n * 1e6) / 1e6);
    expect(round(prepared.hipBox?.min.toArray())).toEqual([-0.2, -0.4, -0.1]);
    expect(round(prepared.hipBox?.max.toArray())).toEqual([0.2, -0.2, 0.1]);
  });

  test("explode moves left and right ribs apart by the same distance and back again", () => {
    const prepared = prepareSkeleton(skeleton(), ATLAS);
    const [, left, right] = prepared.parts;
    applyExplode(prepared.parts, 1);
    expect(left!.mesh.position.x).toBeGreaterThan(0);
    expect(right!.mesh.position.x).toBeLessThan(0);
    expect(left!.mesh.position.length()).toBeCloseTo(right!.mesh.position.length(), 2);
    applyExplode(prepared.parts, 0);
    for (const part of prepared.parts)
      expect(part.mesh.position.toArray()).toEqual([0, 0, 0]);
  });

  test("an explode vector in the file wins", () => {
    const root = new Group();
    root.add(
      bone(
        "FMA_7485",
        { name: "sternum", explode: { direction: [0, 0, 1], distance: 0.3 } },
        [0, 0, 0],
      ),
      bone("FMA_7987", { name: "left first rib" }, [0.1, 0, 0]),
    );
    const prepared = prepareSkeleton(root, ATLAS);
    applyExplode(prepared.parts, 0.5);
    expect(
      prepared.parts[0]!.mesh.position.toArray().map((n) => Math.round(n * 1e6) / 1e6),
    ).toEqual([0, 0, 0.15]);
  });
});
