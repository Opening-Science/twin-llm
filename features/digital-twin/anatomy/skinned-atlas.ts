import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  type Intersection,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  type Raycaster,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";

import {
  boneWeights,
  fitMatrices,
  SEGMENT_IDS,
  skinWeights,
  type Segments,
} from "@/packages/anatomy/segments";

import { attachDepthPrepass, depthPrepassOf } from "./depth-prepass";
import { type PreparedAtlas } from "./prepare-atlas";
import { type BodyReading } from "./read-body";

/**
 * The atlas as a skinned mesh: one bone per body segment, so the GPU lays
 * every vertex on the body segment by segment and carries it along when the
 * body's own bones move. Bone and cartilage are on a second skeleton of
 * their own, whose maps keep their proportions (`fitMatrices`). Nothing of
 * the atlas's geometry is rewritten.
 */

/** Per segment: the bone it follows, and the atlas-to-bone map; no bone means the map is to the world. */
export type Following = Readonly<{
  drive: readonly (Object3D | null)[];
  offsets: readonly Matrix4[];
}>;

const scratch = new Matrix4();

/**
 * A skeleton whose bones are not in the scene: each is placed from the
 * body's bone when three.js updates the skeleton, which is after the body's
 * own matrices in the same frame, so the atlas never lags the skin.
 */
export class FitSkeleton extends Skeleton {
  private following: Following = { drive: [], offsets: [] };

  constructor() {
    super(SEGMENT_IDS.map(() => new Bone()));
  }

  follow(following: Following): void {
    this.following = following;
  }

  update(): void {
    const { drive, offsets } = this.following;
    for (const [i, offset] of offsets.entries()) {
      const bone = drive[i];
      const own = this.bones[i]!.matrixWorld;
      if (bone) own.multiplyMatrices(bone.matrixWorld, offset);
      else own.copy(offset);
    }
    super.update();
  }
}

/**
 * An atlas part on the fit skeleton. Its own transform (the atlas's
 * dequantisation, and the live heartbeat's scale) applies before the bones,
 * so it is bound again whenever that transform is updated. It is never
 * culled: its box is the unfitted atlas's. A pick is tested against the
 * vertices where the bones put them, worked out on the CPU and kept until
 * the body moves.
 */
export class FittedMesh extends SkinnedMesh {
  private posed: Readonly<{ mesh: Mesh; bones: Float32Array }> | null = null;

  constructor(
    geometry: BufferGeometry,
    material: Material | Material[],
    skeleton: FitSkeleton,
  ) {
    super(geometry, material);
    this.frustumCulled = false;
    this.bind(skeleton, new Matrix4());
  }

  updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);
    this.bindMatrix.copy(this.matrixWorld);
  }

  raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const from = intersects.length;
    this.posedMesh().raycast(raycaster, intersects);
    for (const hit of intersects.slice(from)) Object.assign(hit, { object: this });
  }

  private posedMesh(): Mesh {
    const bones = this.skeleton.boneMatrices ?? new Float32Array();
    const known = this.posed;
    if (known && known.bones.every((value, i) => value === bones[i])) return known.mesh;
    const source = this.geometry;
    const position = source.getAttribute("position");
    const index = source.getAttribute("skinIndex");
    const weight = source.getAttribute("skinWeight");
    const world = new Float32Array(3 * position.count);
    const rest = new Vector3();
    const moved = new Vector3();
    const sum = new Vector3();
    for (let i = 0; i < position.count; i += 1) {
      rest.fromBufferAttribute(position, i).applyMatrix4(this.bindMatrix);
      sum.set(0, 0, 0);
      for (const slot of [0, 1]) {
        const share = weight.getComponent(i, slot);
        if (share === 0) continue;
        scratch.fromArray(bones, 16 * index.getComponent(i, slot));
        sum.addScaledVector(moved.copy(rest).applyMatrix4(scratch), share);
      }
      sum.toArray(world, 3 * i);
    }
    const geometry = known?.mesh.geometry ?? new BufferGeometry().setIndex(source.index);
    geometry.setAttribute("position", new BufferAttribute(world, 3));
    geometry.computeBoundingSphere();
    const mesh = known?.mesh ?? new Mesh(geometry, this.material);
    this.posed = { mesh, bones: bones.slice() };
    return mesh;
  }
}

/** A mesh's vertices (x, y, z triples) in the atlas root's frame. */
const atlasPoints = (mesh: Mesh): Float32Array => {
  const position = mesh.geometry.getAttribute("position");
  const points = new Float32Array(3 * position.count);
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point
      .fromBufferAttribute(position, i)
      .applyMatrix4(mesh.matrixWorld)
      .toArray(points, 3 * i);
  }
  return points;
};

/** The two skeletons: soft tissue follows the skin's girth, the skeleton layer does not. */
export type FitSkeletons = Readonly<{ soft: FitSkeleton; bone: FitSkeleton }>;

/** What each of the two skeletons follows. */
export type Followings = Readonly<{ soft: Following; bone: Following }>;

/** What the fit needs to know of a skinned atlas. */
export type AtlasSegments = Readonly<{
  segments: Segments;
  /** The segments that some vertex follows first. */
  held: ReadonlySet<number>;
  /** Per segment, in `SEGMENT_IDS` order: the middle of the skeleton layer's vertices in it. */
  boneCentres: readonly (Vector3 | null)[];
}>;

/**
 * Puts every part of a prepared atlas on the fit skeletons: skin weights
 * from the atlas's own segments, and a skinned mesh in place of each plain
 * one (same geometry, material, name and transform), depth pre-pass
 * included. Bone and cartilage are rigid, one segment per piece
 * (`boneWeights`); everything else blends near a joint (`skinWeights`). The
 * atlas root must sit at the world origin; the bones do the placing.
 */
export const skinAtlas = (
  prepared: PreparedAtlas,
  segments: Segments,
): Readonly<{
  atlas: PreparedAtlas;
  skeletons: FitSkeletons;
  fit: AtlasSegments;
}> => {
  const skeletons = { soft: new FitSkeleton(), bone: new FitSkeleton() };
  const held = new Set<number>();
  const sums = SEGMENT_IDS.map(() => ({ at: new Vector3(), count: 0 }));
  prepared.root.updateMatrixWorld(true);
  const parts = prepared.parts.map((part) => {
    const plain = part.mesh;
    const { geometry } = plain;
    const rigid = part.layer === "skeleton";
    const points = atlasPoints(plain);
    if (!geometry.getAttribute("skinIndex")) {
      const { index, weight } = rigid
        ? boneWeights(points, segments, geometry.index?.array ?? null)
        : skinWeights(points, segments);
      geometry.setAttribute("skinIndex", new BufferAttribute(index, 4));
      geometry.setAttribute("skinWeight", new BufferAttribute(weight, 4, true));
    }
    const first = geometry.getAttribute("skinIndex");
    for (let i = 0; i < first.count; i += 1) {
      const segment = first.getX(i);
      held.add(segment);
      if (!rigid) continue;
      const sum = sums[segment]!;
      sum.at.x += points[3 * i]!;
      sum.at.y += points[3 * i + 1]!;
      sum.at.z += points[3 * i + 2]!;
      sum.count += 1;
    }
    const skeleton = rigid ? skeletons.bone : skeletons.soft;
    const mesh = new FittedMesh(geometry, plain.material, skeleton);
    mesh.name = plain.name;
    mesh.userData = plain.userData;
    mesh.position.copy(plain.position);
    mesh.quaternion.copy(plain.quaternion);
    mesh.scale.copy(plain.scale);
    const depthOnly = depthPrepassOf(plain)?.material;
    plain.parent?.add(mesh);
    plain.removeFromParent();
    if (depthOnly && !Array.isArray(depthOnly)) {
      attachDepthPrepass(
        mesh,
        depthOnly,
        (source, material) => new FittedMesh(source.geometry, material, skeleton),
      );
    }
    return { ...part, mesh };
  });
  const boneCentres = sums.map(({ at, count }) =>
    count > 0 ? at.clone().divideScalar(count) : null,
  );
  return {
    atlas: { ...prepared, parts },
    skeletons,
    fit: { segments, held, boneCentres },
  };
};

/**
 * What the skeletons follow to lay the atlas on a body, or null when a
 * segment would have to be scaled out of all proportion.
 */
export const followBody = (
  atlas: AtlasSegments,
  body: BodyReading,
): Followings | null => {
  const { matrices, bones, ok } = fitMatrices(
    atlas.segments,
    body.segments,
    (index) => atlas.held.has(index),
    atlas.boneCentres,
  );
  if (!ok) return null;
  const following = (maps: readonly Matrix4[]): Following => ({
    drive: body.drive,
    offsets: maps.map((matrix, i) =>
      body.drive[i]!.matrixWorld.clone().invert().multiply(matrix),
    ),
  });
  return { soft: following(matrices), bone: following(bones) };
};

/** One map for every segment: the one-scale fit, shown through the same skeletons. */
export const followMatrix = (matrix: Matrix4): Followings => {
  const following: Following = {
    drive: SEGMENT_IDS.map(() => null),
    offsets: SEGMENT_IDS.map(() => matrix),
  };
  return { soft: following, bone: following };
};

/** Sets both skeletons following. */
export const followWith = (skeletons: FitSkeletons, followings: Followings): void => {
  skeletons.soft.follow(followings.soft);
  skeletons.bone.follow(followings.bone);
};
