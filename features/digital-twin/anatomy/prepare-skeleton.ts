import { Box3, type Material, type Mesh, Matrix4, type Object3D, Vector3 } from "three";

import { explodeVectors, type Vec3 } from "@/packages/anatomy/explode";
import { normaliseGroup } from "@/packages/anatomy/hra-groups";
import {
  isExcluded,
  isModelled,
  readSkeletonNode,
  type SkeletonAtlas,
} from "@/packages/anatomy/open-skeleton";

import { disposeObject3D } from "../dispose-object";
import { createCtMaterial } from "./ct-bone-material";
import { attachDepthPrepass, createDepthPrepassMaterial } from "./depth-prepass";
import { createLayerUniforms, type LayerUniforms } from "./layer-material";
import { type AtlasPart } from "./prepare-atlas";

/** One CT bone: an atlas part on the skeleton layer, plus its name and explode path. */
export type SkeletonPart = AtlasPart &
  Readonly<{
    /** English name for the pick card ("Left first rib"). */
    label: string;
    modelled: boolean;
    /** Marks a part of the CT skeleton rather than the donor atlas. */
    ct: true;
    /** Where the mesh sits as built, in its parent's space. */
    home: Vector3;
    /** Its offset at explode 1, in its parent's space. */
    spread: Vector3;
  }>;

export type PreparedSkeleton = Readonly<{
  root: Object3D;
  parts: readonly SkeletonPart[];
  /** The kept bones' box in the file's frame. */
  box: Box3;
  /** The hip bones' box, when the file has them; the fit anchors there. */
  hipBox: Box3 | null;
  /** T1's centre over L5's (or the sacrum's), when the file has them; the fit stands it upright. */
  spine: Readonly<{ top: Vector3; bottom: Vector3 }> | null;
  uniforms: LayerUniforms;
  triangles: number;
}>;

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

/** GLTFLoader puts node extras on the node's object, which may be the mesh or its group. */
const taggedAncestor = (mesh: Mesh, root: Object3D): Object3D => {
  let node: Object3D | null = mesh;
  while (node && node !== root) {
    if (Object.keys(node.userData).length > 0) return node;
    node = node.parent;
  }
  return mesh;
};

const HIP_BONE = /\bhip bone\b/i;
const SPINE_TOP = /^first thoracic vertebra$/i;
const SPINE_BOTTOM = [/^fifth lumbar vertebra$/i, /^sacrum$/i];

const disposeMaterials = (material: Material | Material[]): void => {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
};

const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];

/**
 * Prepares an open-anatomy skeleton GLB for the Skeleton layer: drops every
 * node atlas.json leaves out (disposed, never hidden), gives each bone the
 * skeleton layer's material on one shared set of uniforms (so it fades to the
 * same rim as the atlas layers), and works out each bone's explode path.
 */
export const prepareSkeleton = (
  root: Object3D,
  atlas: SkeletonAtlas,
): PreparedSkeleton => {
  root.updateMatrixWorld(true);
  const rootInverse = new Matrix4().copy(root.matrixWorld).invert();
  const uniforms = createLayerUniforms(0);
  const depthOnly = createDepthPrepassMaterial();

  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object)) meshes.push(object);
  });

  type Kept = Readonly<{
    mesh: Mesh;
    node: ReturnType<typeof readSkeletonNode>;
    box: Box3;
  }>;
  const kept: Kept[] = [];
  for (const mesh of meshes) {
    const tagged = taggedAncestor(mesh, root);
    const node = readSkeletonNode(tagged.name || mesh.name, tagged.userData);
    if (isExcluded(node, atlas)) {
      mesh.removeFromParent();
      disposeObject3D(mesh);
      continue;
    }
    const geometry = mesh.geometry;
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const previous = mesh.material;
    // One material per bone, so a pick lights only that bone; open-anatomy's
    // bone and cartilage tones (ct-bone-material.ts).
    mesh.material = createCtMaterial(
      isModelled(node, atlas) ? "cartilage" : "bone",
      uniforms,
    );
    disposeMaterials(previous);
    attachDepthPrepass(mesh, depthOnly);
    // The box in the file's frame, whatever the root's own transform.
    const box = new Box3().setFromObject(mesh).applyMatrix4(rootInverse);
    kept.push({ mesh, node, box });
  }

  const vectors = explodeVectors(
    kept.map((item) => ({
      centre: toVec3(item.box.getCenter(new Vector3())),
      given: item.node.explode,
    })),
  );

  let triangles = 0;
  const parts = kept.map((item, index): SkeletonPart => {
    const { mesh, node } = item;
    const vector = vectors[index]!;
    // The offset is in the file's frame; the mesh moves in its parent's.
    const centre = item.box.getCenter(new Vector3());
    const toParent = new Matrix4()
      .copy(mesh.parent ? mesh.parent.matrixWorld : new Matrix4())
      .invert()
      .multiply(root.matrixWorld);
    const end = centre
      .clone()
      .add(new Vector3(...vector.direction).multiplyScalar(vector.distance));
    const spread = end.applyMatrix4(toParent).sub(centre.clone().applyMatrix4(toParent));
    const geometry = mesh.geometry;
    triangles += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
    return {
      mesh,
      layer: "skeleton",
      system: "musculoskeletal",
      group: normaliseGroup(node.name),
      name: node.name,
      ontologyId: node.term,
      label: node.label,
      modelled: isModelled(node, atlas),
      ct: true,
      home: mesh.position.clone(),
      spread,
    };
  });

  const box = new Box3();
  const hips = new Box3();
  for (const item of kept) {
    box.union(item.box);
    if (HIP_BONE.test(item.node.label)) hips.union(item.box);
  }
  const centreOf = (pattern: RegExp): Vector3 | null => {
    const found = kept.find((item) => pattern.test(item.node.label));
    return found ? found.box.getCenter(new Vector3()) : null;
  };
  const top = centreOf(SPINE_TOP);
  const bottom =
    SPINE_BOTTOM.map(centreOf).find((centre): centre is Vector3 => centre !== null) ??
    null;
  return {
    root,
    parts,
    box,
    hipBox: hips.isEmpty() ? null : hips,
    spine: top && bottom ? { top, bottom } : null,
    uniforms,
    triangles,
  };
};

/** Moves every bone to its explode position at t (0 as built, 1 fully apart). */
export const applyExplode = (parts: readonly SkeletonPart[], t: number): void => {
  const amount = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (const part of parts) {
    part.mesh.position.copy(part.home).addScaledVector(part.spread, amount);
  }
};
