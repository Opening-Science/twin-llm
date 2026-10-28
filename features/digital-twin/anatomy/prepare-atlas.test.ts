import { describe, expect, test } from "bun:test";
import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";

import { ATLASES } from "@/packages/anatomy/manifest";

import { layerFadeUniforms } from "./layer-material";
import { prepareAtlas } from "./prepare-atlas";
import { collectScanMaterials, readScanFrame } from "./scan-frame";

/** A triangle without normals, like the meshopt atlases, with optional AO colours. */
const triangle = (withColour: boolean): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1.7, 0]), 3),
  );
  if (withColour) {
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(9).fill(0.8), 3));
  }
  return geometry;
};

const node = (extras: Record<string, unknown>, name: string, withColour = true): Mesh => {
  const mesh = new Mesh(triangle(withColour), new MeshStandardMaterial());
  mesh.name = name;
  mesh.userData = extras;
  return mesh;
};

describe("prepareAtlas (BodyParts3D extras)", () => {
  test("classifies layers, drops the skin, computes normals and swaps materials", () => {
    const root = new Group();
    const skin = node({ system: "integumentary", layer: "organ" }, "integumentaryorgan");
    const disposed: string[] = [];
    skin.geometry.addEventListener("dispose", () => disposed.push("skin-geometry"));
    const muscle = node(
      { system: "musculoskeletal", layer: "muscle" },
      "musculoskeletalmuscle",
    );
    const oldMaterial = muscle.material as MeshStandardMaterial;
    oldMaterial.addEventListener("dispose", () => disposed.push("old-material"));
    root.add(
      skin,
      muscle,
      node({ system: "musculoskeletal", layer: "bone" }, "musculoskeletalbone"),
      node({ system: "cardiovascular", layer: "organ" }, "cardiovascularorgan", false),
      node({ system: "nervous", layer: "organ" }, "nervousorgan"),
    );

    const prepared = prepareAtlas(root, ATLASES.bodyparts3d);

    expect(prepared.box.max.y).toBeCloseTo(1.7, 6);
    expect(
      prepared.parts.map((part) => [part.mesh.name, part.layer, part.system]),
    ).toEqual([
      ["musculoskeletalmuscle", "muscle", "musculoskeletal"],
      ["musculoskeletalbone", "skeleton", "musculoskeletal"],
      ["cardiovascularorgan", "organs", "cardiovascular"],
      ["nervousorgan", "organs", "nervous"],
    ]);
    expect(skin.parent).toBeNull();
    expect(disposed).toEqual(["skin-geometry", "old-material"]);
    expect([...prepared.presentLayers]).toEqual(["muscle", "skeleton", "organs"]);
    expect(prepared.systems).toEqual(["cardiovascular", "nervous"]);
    expect(prepared.triangles).toBe(4);
    for (const part of prepared.parts) {
      const normal = part.mesh.geometry.getAttribute("normal");
      expect([normal.count, normal.itemSize]).toEqual([3, 3]);
      // The triangle lies in the XY plane, so every computed normal is +Z.
      expect([normal.getX(0), normal.getY(0), normal.getZ(0)]).toEqual([0, 0, 1]);
      expect(part.mesh.material).not.toBe(oldMaterial);
    }
    const cardio = prepared.parts[2].mesh.material as MeshStandardMaterial;
    expect(cardio.vertexColors).toBe(false);
    expect((prepared.parts[0].mesh.material as MeshStandardMaterial).vertexColors).toBe(
      true,
    );
    expect(layerFadeUniforms(cardio)).toBe(prepared.uniforms.organs);
  });
});

describe("prepareAtlas (HRA extras)", () => {
  test("hides the placenta, drops skin, keeps knee muscle and unnamed parts", () => {
    const root = new Group();
    const group = new Group();
    group.userData = { anatomical_structure_of: "#VHFLiver" };
    group.add(node({}, "VH_F_liver_part_1"));
    root.add(
      node({ anatomical_structure_of: "#VHFSkinV1.2" }, "VH_F_skin"),
      node({ anatomical_structure_of: "#VHFPlacentaFullTerm" }, "VH_F_placenta"),
      node({ anatomical_structure_of: "#VHFMusclesLeftKnee" }, "#VHFMusclesLeftKnee"),
      node({ anatomical_structure_of: "-", label: "-" }, "VH_F_unlabelled"),
      group,
    );

    const prepared = prepareAtlas(root, ATLASES["hra-f"]);

    expect(prepared.parts.map((part) => [part.layer, part.system])).toEqual([
      ["muscle", "musculoskeletal"],
      ["organs", "unassigned"],
      ["organs", "metabolic"],
    ]);
    expect([...prepared.presentLayers]).toEqual(["muscle", "organs"]);
  });
});

describe("prepareAtlas part identity", () => {
  test("HRA parts keep group key, node name and ontology id", () => {
    const root = new Group();
    const liver = new Group();
    liver.name = "VH_F_liver";
    liver.userData = { anatomical_structure_of: "#VHFLiver", ontologyid: "FMA:7197" };
    liver.add(node({}, "VH_F_liver_part_1"));
    root.add(
      node(
        { anatomical_structure_of: "#VHFLeftKidneyV1.1", ontologyid: "UBERON:0004538" },
        "VH_F_kidney_left",
      ),
      node({ anatomical_structure_of: "#VHFRightKidneyV1.1" }, "VH_F_kidney_right"),
      node({ anatomical_structure_of: "#VHFVertebrae", ontologyid: "-" }, "VH_F_L1"),
      node({ anatomical_structure_of: "-", label: "-" }, "VH_F_unlabelled"),
      liver,
    );

    const prepared = prepareAtlas(root, ATLASES["hra-f"]);

    expect(
      prepared.parts.map((part) => [part.name, part.group, part.ontologyId, part.layer]),
    ).toEqual([
      ["VH_F_kidney_left", "kidney", "UBERON:0004538", "organs"],
      ["VH_F_kidney_right", "kidney", null, "organs"],
      ["VH_F_L1", "vertebrae", null, "skeleton"],
      ["VH_F_unlabelled", "unlabelled", null, "organs"],
      ["VH_F_liver", "liver", "FMA:7197", "organs"],
    ]);
    // A node whose structure is the "-" placeholder is a group of its own name.
    expect(prepared.groups).toEqual([
      { key: "kidney", label: "Kidney" },
      { key: "vertebrae", label: "Vertebrae" },
      { key: "unlabelled", label: "Unlabelled" },
      { key: "liver", label: "Liver" },
    ]);
    expect(prepared.partSystems).toEqual(["endocrine", "musculoskeletal", "metabolic"]);
    expect(prepared.systems).toEqual(["endocrine", "unassigned", "metabolic"]);
    // Left and right kidney are one view: the UI needs no mesh to check toggles.
    expect(prepared.views).toEqual([
      { layer: "organs", system: "endocrine", group: "kidney" },
      { layer: "skeleton", system: "musculoskeletal", group: "vertebrae" },
      { layer: "organs", system: "unassigned", group: "unlabelled" },
      { layer: "organs", system: "metabolic", group: "liver" },
    ]);
  });

  test("BodyParts3D parts have no group or ontology id (bar an unknown system), and list every layer's system", () => {
    const root = new Group();
    root.add(
      node({ system: "musculoskeletal", layer: "muscle" }, "musculoskeletalmuscle"),
      node({ system: "musculoskeletal", layer: "bone" }, "musculoskeletalbone"),
      node({ system: "metabolic", layer: "organ" }, "metabolicorgan"),
      node({ layer: "organ" }, "mystery"),
    );

    const prepared = prepareAtlas(root, ATLASES.bodyparts3d);

    expect(
      prepared.parts.map((part) => [part.name, part.group, part.ontologyId, part.system]),
    ).toEqual([
      ["musculoskeletalmuscle", null, null, "musculoskeletal"],
      ["musculoskeletalbone", null, null, "musculoskeletal"],
      ["metabolicorgan", null, null, "metabolic"],
      ["mystery", "mystery", null, "unassigned"],
    ]);
    // No system to light, so the part is a group of its own name.
    expect(prepared.groups).toEqual([{ key: "mystery", label: "Mystery" }]);
    expect(prepared.partSystems).toEqual(["musculoskeletal", "metabolic"]);
  });
});

describe("prepareAtlas box", () => {
  /** An axis-aligned box mesh spanning [min, max], tagged like an HRA node. */
  const slab = (
    structure: string,
    min: readonly [number, number, number],
    max: readonly [number, number, number],
  ): Mesh => {
    const mesh = new Mesh(
      new BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
      new MeshStandardMaterial(),
    );
    mesh.position.set(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    );
    mesh.name = structure;
    mesh.userData = { anatomical_structure_of: structure };
    return mesh;
  };

  test("height from the whole atlas, x and z from the kept parts only", () => {
    const root = new Group();
    root.add(
      // skin: the tallest part, dropped
      slab("#VHFSkinV1.2", [-0.3, -0.83, -0.15], [0.3, 0.83, 0.15]),
      // placenta: hidden, reaching 12 cm in front of the skin
      slab("#VHFPlacentaFullTerm", [-0.1, -0.1, 0.05], [0.1, 0.15, 0.27]),
      // kept muscle, shorter and narrower than the skin
      slab("#VHFMusclesLeftKnee", [-0.25, -0.8, -0.12], [0.2, 0.75, 0.1]),
    );

    const prepared = prepareAtlas(root, ATLASES["hra-f"]);

    expect(prepared.parts.map((part) => part.mesh.name)).toEqual(["#VHFMusclesLeftKnee"]);
    const { min, max } = prepared.box;
    expect([min.x, min.y, min.z].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([
      -0.25, -0.83, -0.12,
    ]);
    expect([max.x, max.y, max.z].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([
      0.2, 0.83, 0.1,
    ]);
  });
});

describe("readScanFrame", () => {
  const rig = (hipZ: number, prefix = "") => {
    const root = new Group();
    const body = new Mesh(new BoxGeometry(1, 0.4, 1.8), new MeshStandardMaterial());
    body.position.set(0, 0, 0.9);
    const left = new Bone();
    left.name = `${prefix}LeftUpLeg`;
    left.position.set(0.1, 0.01, hipZ);
    const right = new Bone();
    right.name = `${prefix}RightUpLeg`;
    right.position.set(-0.08, 0.01, hipZ);
    root.add(body, left, right);
    return root;
  };

  test("reads floor, height and the hip-joint midpoint", () => {
    const frame = readScanFrame(rig(0.95));
    expect(frame.floorZ).toBeCloseTo(0, 6);
    expect(frame.height).toBeCloseTo(1.8, 6);
    expect(frame.hipMidpoint?.toArray().map((n) => Math.round(n * 1000) / 1000)).toEqual([
      0.01, 0.01, 0.95,
    ]);
  });

  test("keeps a plausible measured stature and drops an implausible one", () => {
    // box height 1.8 m: stature may be 0.85–1.02 of it
    expect(readScanFrame(rig(0.95), 1.75).stature).toBe(1.75);
    expect(readScanFrame(rig(0.95), 1.83).stature).toBe(1.83);
    expect(readScanFrame(rig(0.95)).stature).toBeNull();
    expect(readScanFrame(rig(0.95), 1.9).stature).toBeNull();
    expect(readScanFrame(rig(0.95), 1.2).stature).toBeNull();
    expect(readScanFrame(rig(0.95), Number.NaN).stature).toBeNull();
  });

  test("matches prefixed bone names", () => {
    expect(readScanFrame(rig(0.95, "mixamorig")).hipMidpoint).not.toBeNull();
  });

  test("drops an implausible hip height", () => {
    expect(readScanFrame(rig(1.5)).hipMidpoint).toBeNull();
  });

  test("collectScanMaterials lists each material once", () => {
    const shared = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), shared), new Mesh(new BoxGeometry(), shared));
    expect(collectScanMaterials(root)).toEqual([shared]);
  });
});
