import { describe, expect, test } from "bun:test";

import {
  BODYPARTS3D_TRUNK,
  bodyParts3dMesh,
  ctRegion,
  ctRegions,
  hraRegion,
  keptFirst,
  matchTrunkPiece,
  MATCH_TOLERANCE,
  meshPieces,
  replacedByCt,
} from "./ct-cover";

describe("ctRegion", () => {
  test("reads a CT bone's English name", () => {
    expect(ctRegion("left fifth rib")).toBe("rib");
    expect(ctRegion("first thoracic vertebra")).toBe("thoracic-vertebra");
    expect(ctRegion("fifth lumbar vertebra")).toBe("lumbar-vertebra");
    expect(ctRegion("sacrum")).toBe("sacrum");
    expect(ctRegion("right hip bone")).toBe("hip-bone");
    expect(ctRegion("sternum")).toBe("sternum");
    expect(ctRegion("set of costal cartilages")).toBe("costal-cartilage");
  });

  test("names it does not cover have no region", () => {
    expect(ctRegion("left clavicle")).toBeNull();
    expect(ctRegion("seventh cervical vertebra")).toBeNull();
    expect(ctRegion("left femur")).toBeNull();
  });

  test("a build's regions are those it has a bone in", () => {
    expect([...ctRegions(["left first rib", "sacrum", "left clavicle"])].sort()).toEqual([
      "rib",
      "sacrum",
    ]);
  });
});

describe("replacedByCt", () => {
  test("discs go with their vertebrae", () => {
    const thoracic = new Set(["thoracic-vertebra"] as const);
    expect(replacedByCt("thoracic-disc", thoracic)).toBe(true);
    expect(replacedByCt("lumbar-disc", thoracic)).toBe(false);
  });

  test("an atlas bone stays when the CT has none of its kind", () => {
    expect(replacedByCt("rib", new Set(["sacrum"] as const))).toBe(false);
  });
});

describe("hraRegion", () => {
  test("reads HRA node names", () => {
    expect(hraRegion("#VHMPelvis")).toBe("hip-bone");
    expect(hraRegion("#VHFVertebrae")).toBe("thoracic-vertebra");
    expect(hraRegion("#VHMIntervertebralDisk")).toBe("thoracic-disc");
    expect(hraRegion("VH_F_sternum")).toBe("sternum");
    expect(hraRegion("VH_F_manubrium")).toBe("sternum");
  });

  test("knees and the hyoid stay", () => {
    expect(hraRegion("#VHMLeftKnee")).toBeNull();
    expect(hraRegion("VH_M_hyoid")).toBeNull();
  });
});

describe("BODYPARTS3D_TRUNK", () => {
  const count = (pattern: RegExp): number =>
    BODYPARTS3D_TRUNK.filter(([, , label]) => pattern.test(label)).length;

  test("names T1 to L5, the sacrum, both hip bones, 24 ribs and 17 discs once each", () => {
    expect(count(/thoracic vertebra$/)).toBe(12);
    expect(count(/lumbar vertebra$/)).toBe(5);
    expect(count(/^sacrum$/)).toBe(1);
    expect(count(/hip bone$/)).toBe(2);
    expect(count(/^left .* rib$/)).toBe(12);
    expect(count(/^right .* rib$/)).toBe(12);
    expect(count(/^intervertebral disc/)).toBe(17);
    expect(new Set(BODYPARTS3D_TRUNK.map(([, , label]) => label)).size).toBe(
      BODYPARTS3D_TRUNK.length,
    );
  });

  test("no two pieces of one mesh are close enough to be confused", () => {
    for (const [i, [mesh, , , a]] of BODYPARTS3D_TRUNK.entries()) {
      for (const [mesh2, , , b] of BODYPARTS3D_TRUNK.slice(i + 1)) {
        if (mesh !== mesh2) continue;
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(
          2 * MATCH_TOLERANCE,
        );
      }
    }
  });

  test("a centre matches within the tolerance and only on its own mesh", () => {
    const [mesh, , label, [x, y, z]] = BODYPARTS3D_TRUNK[0];
    expect(matchTrunkPiece(mesh, [x + MATCH_TOLERANCE / 2, y, z])?.[2]).toBe(label);
    expect(matchTrunkPiece(mesh, [x + 2 * MATCH_TOLERANCE, y, z])).toBeNull();
    expect(matchTrunkPiece("connective", [x, y, z])).toBeNull();
  });

  test("reads the BodyParts3D mesh from its node name, sanitised or not", () => {
    expect(bodyParts3dMesh("musculoskeletal/bone")).toBe("bone");
    expect(bodyParts3dMesh("musculoskeletalbone")).toBe("bone");
    expect(bodyParts3dMesh("musculoskeletal_connective")).toBe("connective");
    expect(bodyParts3dMesh("musculoskeletal/muscle")).toBeNull();
  });
});

// Two unit triangles a step apart on x, the second split into two vertices
// sets that share positions (as a mesh split for colours would).
const position = [
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
  0, // piece A
  5,
  0,
  0,
  6,
  0,
  0,
  5,
  1,
  0, // piece B, first triangle
  6,
  0,
  0,
  5,
  1,
  0,
  6,
  1,
  0, // piece B, second triangle, its own vertices
]; // fmt: skip
const index = [0, 1, 2, 3, 4, 5, 6, 7, 8];

describe("meshPieces", () => {
  test("joins vertices at one position, so a split mesh stays one piece", () => {
    const pieces = meshPieces(position, index);
    expect(pieces.triangles).toEqual([[0], [1, 2]]);
    expect(pieces.centres[1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([
      5.5, 0.5, 0,
    ]);
    expect(pieces.boxes[1]).toEqual([
      [5, 0, 0],
      [6, 1, 0],
    ]);
  });
});

describe("keptFirst", () => {
  test("puts the dropped pieces last and counts the kept indices", () => {
    const pieces = meshPieces(position, index);
    const { index: order, kept } = keptFirst(index, pieces, ([x]) => x < 1);
    expect(kept).toBe(6);
    expect(order).toEqual([3, 4, 5, 6, 7, 8, 0, 1, 2]);
  });

  test("dropping nothing keeps the order", () => {
    const pieces = meshPieces(position, index);
    expect(keptFirst(index, pieces, () => false)).toEqual({ index, kept: 9 });
  });
});
