import { Box3, Matrix4, type Mesh, type Object3D, Vector3 } from "three";

import {
  bodyParts3dMesh,
  type CtRegion,
  hraRegion,
  keptFirst,
  matchTrunkPiece,
  meshPieces,
  type Pieces,
  replacedByCt,
} from "@/packages/anatomy/ct-cover";
import { ACETABULUM_SHARE, type TrunkMarks } from "@/packages/anatomy/fit";
import { type AtlasScheme } from "@/packages/anatomy/manifest";

import { type AtlasPart } from "./prepare-atlas";

/** What the atlas draws of one bone mesh with the CT skeleton on. */
export type CtTrim = "all" | "none" | Readonly<{ kept: number }>;

export type AtlasTrim = Readonly<{
  trims: ReadonlyMap<Mesh, CtTrim>;
  /** The atlas's own hip joints and T1, in its root's frame; null when it has no table. */
  marks: TrunkMarks | null;
}>;

const positions = (mesh: Mesh): Float32Array => {
  const attribute = mesh.geometry.getAttribute("position");
  const out = new Float32Array(attribute.count * 3);
  // getX/Y/Z undo the quantisation, so centres match the table's units.
  for (let v = 0; v < attribute.count; v += 1) {
    out[v * 3] = attribute.getX(v);
    out[v * 3 + 1] = attribute.getY(v);
    out[v * 3 + 2] = attribute.getZ(v);
  }
  return out;
};

/** T1's centre and the hip joints from the hip bones' box, in the mesh's own frame. */
const trunkMarks = (pieces: Pieces): TrunkMarks | null => {
  let t1: Vector3 | null = null;
  const hips = new Box3();
  pieces.centres.forEach((centre, piece) => {
    const label = matchTrunkPiece("bone", centre)?.[2];
    if (label === "first thoracic vertebra") t1 = new Vector3(...centre);
    if (label?.endsWith("hip bone")) {
      const [low, high] = pieces.boxes[piece];
      hips.expandByPoint(new Vector3(...low)).expandByPoint(new Vector3(...high));
    }
  });
  if (t1 === null || hips.isEmpty()) return null;
  return {
    t1,
    hips: new Vector3(
      (hips.min.x + hips.max.x) / 2,
      hips.min.y + ACETABULUM_SHARE * (hips.max.y - hips.min.y),
      (hips.min.z + hips.max.z) / 2,
    ),
  };
};

/**
 * Works out, per atlas skeleton mesh, what stays drawn beside a CT skeleton
 * that covers `covered`. A BodyParts3D mesh is reordered in place, so its
 * replaced pieces come last and a draw range of `kept` leaves them out; the
 * reorder changes no shape, and the full range still draws every triangle.
 * A BodyParts3D mesh none of whose pieces the table names (a refitted atlas)
 * is hidden whole, as before. An HRA mesh is kept or hidden whole.
 */
export const trimAtlasForCt = (
  root: Object3D,
  parts: readonly AtlasPart[],
  scheme: AtlasScheme,
  covered: ReadonlySet<CtRegion>,
): AtlasTrim => {
  const trims = new Map<Mesh, CtTrim>();
  let marks: TrunkMarks | null = null;
  root.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
  for (const part of parts) {
    if (part.layer !== "skeleton") continue;
    if (scheme === "hra") {
      const region = hraRegion(part.name);
      trims.set(
        part.mesh,
        region !== null && replacedByCt(region, covered) ? "none" : "all",
      );
      continue;
    }
    const kind = bodyParts3dMesh(part.name);
    const index = part.mesh.geometry.index;
    if (kind === null || index === null) {
      trims.set(part.mesh, "all");
      continue;
    }
    const pieces = meshPieces(positions(part.mesh), index.array);
    if (!pieces.centres.some((centre) => matchTrunkPiece(kind, centre) !== null)) {
      // Not the pinned file's pieces (a refitted atlas): hide it whole, as before.
      trims.set(part.mesh, "none");
      continue;
    }
    const { index: order, kept } = keptFirst(index.array, pieces, (centre) => {
      const piece = matchTrunkPiece(kind, centre);
      return piece !== null && replacedByCt(piece[1], covered);
    });
    index.array.set(order);
    index.needsUpdate = true;
    trims.set(part.mesh, { kept });
    if (kind === "bone") {
      const local = trunkMarks(pieces);
      if (local) {
        const toRoot = new Matrix4().multiplyMatrices(rootInverse, part.mesh.matrixWorld);
        marks = {
          t1: local.t1.applyMatrix4(toRoot),
          hips: local.hips.applyMatrix4(toRoot),
        };
      }
    }
  }
  return { trims, marks };
};

/** Sets a mesh's draw range for its trim, with the CT skeleton on or off. */
export const applyCtTrim = (
  mesh: Mesh,
  trim: CtTrim | undefined,
  ctOn: boolean,
): void => {
  const count =
    ctOn && trim !== undefined && typeof trim === "object" ? trim.kept : Infinity;
  if (mesh.geometry.drawRange.count !== count) mesh.geometry.setDrawRange(0, count);
};
