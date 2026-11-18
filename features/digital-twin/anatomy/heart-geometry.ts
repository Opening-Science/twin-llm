import { Box3, type Mesh, type Object3D, Vector3 } from "three";
import { z } from "zod";

// Cardiac walls, cavities, myocardium and valves in the pinned BodyParts3D metadata.
// Coronary vessels are deliberately excluded.
const HEART_STRUCTURES = new Set([
  "FMA:7247",
  "FMA:86064",
  "FMA:9553",
  "FMA:7242",
  "FMA:7238",
  "FMA:9466",
  "FMA:9291",
  "FMA:11359",
  "FMA:9465",
  "FMA:7254",
  "FMA:7250",
  "FMA:86063",
  "FMA:9555",
  "FMA:7252",
  "FMA:86056",
  "FMA:7239",
  "FMA:7249",
  "FMA:7253",
  "FMA:7240",
  "FMA:7262",
  "FMA:9531",
  "FMA:9457",
]);
const structuresSchema = z.array(
  z.object({ system: z.string(), ontologyid: z.string() }),
);
const masks = new WeakMap<Mesh, Uint8Array | null>();

/** Shared by animation and picking: never infer a heart from a whole-system bounding box. */
export const heartVertexMask = (mesh: Mesh): Uint8Array | null => {
  const cached = masks.get(mesh);
  if (cached !== undefined) return cached;
  const fail = (reason: string): null => {
    console.warn(`[anatomy] Heart structure IDs unavailable for ${mesh.name}: ${reason}`);
    masks.set(mesh, null);
    return null;
  };
  let node: Object3D | null = mesh;
  while (node && node.userData.structures === undefined) node = node.parent;
  const structures = structuresSchema.safeParse(node?.userData.structures);
  const ids = mesh.geometry.getAttribute("_structure");
  const position = mesh.geometry.getAttribute("position");
  if (!structures.success || !ids || !position || ids.count !== position.count) {
    return fail("missing anatomy IDs or structure metadata");
  }
  const mask = new Uint8Array(position.count);
  let heartCount = 0;
  for (let i = 0; i < ids.count; i += 1) {
    const id = ids.getX(i);
    const structure = structures.data[id];
    if (!Number.isInteger(id) || structure?.system !== "cardiovascular") {
      return fail("invalid cardiovascular structure ID");
    }
    if (HEART_STRUCTURES.has(structure.ontologyid)) {
      mask[i] = 1;
      heartCount += 1;
    }
  }
  if (heartCount === 0) return fail("no tagged heart structures");
  masks.set(mesh, mask);
  return mask;
};

/** HRA has a heart group; BodyParts3D needs the anatomy IDs of the hit triangle. */
export const isHeartHit = (
  part: Readonly<{ mesh: Mesh; group: string | null; system: string }>,
  face: Readonly<{ a: number; b: number; c: number }> | null | undefined,
): boolean => {
  if (part.group === "heart") return true;
  if (part.group !== null || part.system !== "cardiovascular" || !face) return false;
  const mask = heartVertexMask(part.mesh);
  return mask !== null && [face.a, face.b, face.c].every((index) => mask[index] === 1);
};

/** Current heart bounds in world space, excluding vessels on the merged atlas. */
export const heartWorldBox = (mesh: Mesh, tagged: boolean): Box3 | null => {
  mesh.updateWorldMatrix(true, false);
  if (!tagged) return new Box3().setFromObject(mesh);
  const mask = heartVertexMask(mesh);
  if (!mask) return null;
  const position = mesh.geometry.getAttribute("position");
  const box = new Box3();
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    if (mask[i]) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(point);
    }
  }
  return box.isEmpty() ? null : box;
};
