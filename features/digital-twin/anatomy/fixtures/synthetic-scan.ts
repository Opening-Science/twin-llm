import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  type Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";

import { atlasToScanRotation } from "@/packages/anatomy/fit";
import {
  syntheticFigure,
  type Figure,
  type FigureShape,
} from "@/packages/anatomy/fixtures/synthetic-figure";
import { type SegmentId } from "@/packages/anatomy/segments";

/**
 * A synthetic scan for tests: a tube figure skinned to a skeleton with the
 * BodyLoop scans' Mixamo-style joint names, in the scan frame (+Z up, faces
 * -Y), each vertex moved by its own segment's bone. No person or scan was
 * used. `framing` moves the whole scan, as a scan that is off centre or
 * turned would be.
 */
const up = (figure: Figure, share: number): Vector3 =>
  figure.joints.neck.clone().multiplyScalar(share);

/** Each bone: its parent, where it sits, and the segment whose skin it moves. */
const rig = (
  figure: Figure,
): readonly Readonly<{
  name: string;
  parent: string | null;
  at: Vector3;
  segment?: SegmentId;
}>[] => {
  const { joints } = figure;
  const sides = (["L", "R"] as const).flatMap((side) => {
    const word = side === "L" ? "Left" : "Right";
    return [
      {
        name: `${word}Shoulder`,
        parent: "Spine2",
        at: joints.shoulder[side].clone().lerp(up(figure, 0.75), 0.6),
      },
      {
        name: `${word}Arm`,
        parent: `${word}Shoulder`,
        at: joints.shoulder[side],
        segment: `upperArm${side}`,
      },
      {
        name: `${word}ForeArm`,
        parent: `${word}Arm`,
        at: joints.elbow[side],
        segment: `forearm${side}`,
      },
      {
        name: `${word}Hand`,
        parent: `${word}ForeArm`,
        at: joints.wrist[side],
        segment: `hand${side}`,
      },
      {
        name: `${word}UpLeg`,
        parent: "Hips",
        at: joints.hip[side],
        segment: `thigh${side}`,
      },
      {
        name: `${word}Leg`,
        parent: `${word}UpLeg`,
        at: joints.knee[side],
        segment: `shin${side}`,
      },
      {
        name: `${word}Foot`,
        parent: `${word}Leg`,
        at: joints.ankle[side],
        segment: `foot${side}`,
      },
      {
        name: `${word}ToeBase`,
        parent: `${word}Foot`,
        at: joints.ankle[side].clone().lerp(figure.toe[side], 0.7),
      },
    ] as const;
  });
  return [
    { name: "Hips", parent: null, at: up(figure, 0), segment: "pelvis" },
    { name: "Spine", parent: "Hips", at: up(figure, 0.15), segment: "abdomen" },
    { name: "Spine1", parent: "Spine", at: up(figure, 0.3) },
    { name: "Spine2", parent: "Spine1", at: up(figure, 0.45), segment: "chest" },
    { name: "Neck", parent: "Spine2", at: up(figure, 0.82), segment: "neck" },
    { name: "Head", parent: "Neck", at: up(figure, 1), segment: "head" },
    ...sides,
  ];
};

export const syntheticScan = (
  shape: FigureShape,
  framing?: Matrix4,
): Readonly<{ root: Group; mesh: SkinnedMesh; figure: Figure }> => {
  const figure = syntheticFigure(shape);
  const bones = new Map<string, Bone>();
  const world = new Map<string, Vector3>();
  const owner = new Map<SegmentId, number>();
  const root = new Group();
  for (const [index, entry] of rig(figure).entries()) {
    const bone = new Bone();
    bone.name = `mixamorig${entry.name}`;
    bone.position.copy(entry.at).sub(world.get(entry.parent ?? "") ?? new Vector3());
    (bones.get(entry.parent ?? "") ?? root).add(bone);
    bones.set(entry.name, bone);
    world.set(entry.name, entry.at);
    if (entry.segment) owner.set(entry.segment, index);
  }

  const positions: number[] = [];
  const skinIndex: number[] = [];
  const triangles: number[] = [];
  for (const tube of figure.tubes) {
    const start = positions.length / 3;
    const ring = tube.rings[0]!.length;
    for (const point of tube.rings.flat()) {
      positions.push(...point.toArray());
      skinIndex.push(owner.get(tube.segment) ?? 0, 0, 0, 0);
    }
    for (let r = 0; r + 1 < tube.rings.length; r += 1) {
      for (let k = 0; k < ring; k += 1) {
        const a = start + r * ring + k;
        const b = start + r * ring + ((k + 1) % ring);
        triangles.push(a, b, a + ring, b, b + ring, a + ring);
      }
    }
  }
  const count = positions.length / 3;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setAttribute("skinIndex", new BufferAttribute(Uint16Array.from(skinIndex), 4));
  geometry.setAttribute(
    "skinWeight",
    new BufferAttribute(
      Float32Array.from({ length: 4 * count }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      4,
    ),
  );
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.name = "SyntheticScan";
  root.add(mesh);
  root.applyMatrix4(atlasToScanRotation());
  if (framing) root.applyMatrix4(framing);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([...bones.values()]));
  return { root, mesh, figure };
};
