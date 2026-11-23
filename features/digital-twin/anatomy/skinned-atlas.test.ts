import { describe, expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from "three";

import { ATLASES } from "@/packages/anatomy/manifest";
import {
  AVERAGE_FIGURE,
  HEAVY_FIGURE,
  syntheticFigure,
} from "@/packages/anatomy/fixtures/synthetic-figure";
import { fitMatrices, SEGMENT_IDS, segmentsFromSkin } from "@/packages/anatomy/segments";

import { clipPose } from "../motion/clip-pose";
import { applyPose, bindRig } from "../motion/rig-map";
import { depthPrepassOf } from "./depth-prepass";
import { syntheticScan } from "./fixtures/synthetic-scan";
import { prepareAtlas } from "./prepare-atlas";
import { readBody } from "./read-body";
import {
  FittedMesh,
  followBody,
  followMatrix,
  followWith,
  skinAtlas,
  type FitSkeletons,
} from "./skinned-atlas";

/**
 * A synthetic atlas in the atlas frame: the average figure's skin as the
 * hull, a "bone" mesh with one small triangle at chosen places, and a
 * "liver" mesh with one triangle in the abdomen.
 */
const atlasFigure = syntheticFigure(AVERAGE_FIGURE);
const { joints } = atlasFigure;
const crownOf = (shape: typeof AVERAGE_FIGURE): Vector3 =>
  new Vector3(0, shape.trunk + shape.head.top, 0);
const MARKS = {
  kneeL: joints.knee.L,
  wristL: joints.wrist.L,
  wristR: joints.wrist.R,
  ankleL: joints.ankle.L,
  ankleR: joints.ankle.R,
  toeL: atlasFigure.toe.L,
  toeR: atlasFigure.toe.R,
  fingerL: atlasFigure.finger.L,
  fingerR: atlasFigure.finger.R,
  crown: crownOf(AVERAGE_FIGURE),
  midShinL: joints.knee.L.clone().lerp(joints.ankle.L, 0.5),
  midThighL: joints.hip.L.clone().lerp(joints.knee.L, 0.5),
  midUpperArmR: joints.shoulder.R.clone().lerp(joints.elbow.R, 0.5),
} as const;
const MARK_NAMES = Object.keys(MARKS) as (keyof typeof MARKS)[];
const LIVER = new Vector3(-0.06, 0.3 * AVERAGE_FIGURE.trunk, 0.02);
/** A mark's triangle: the mark, and a corner this far along x and along y. */
const EDGE = 0.004;

const triangles = (points: readonly Vector3[]): BufferAttribute =>
  new BufferAttribute(
    Float32Array.from(
      points.flatMap((mark) => [
        ...mark.toArray(),
        ...mark
          .clone()
          .add(new Vector3(EDGE, 0, 0))
          .toArray(),
        ...mark
          .clone()
          .add(new Vector3(0, EDGE, 0))
          .toArray(),
      ]),
    ),
    3,
  );

const syntheticAtlas = () => {
  const root = new Group();
  const skin = new BufferGeometry();
  skin.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.from(
        atlasFigure.tubes.flatMap((tube) =>
          tube.rings.flat().flatMap((point) => point.toArray()),
        ),
      ),
      3,
    ),
  );
  const hull = new Mesh(skin, new MeshStandardMaterial());
  hull.userData = { system: "integumentary", layer: "organ" };
  const bones = new BufferGeometry();
  bones.setAttribute("position", triangles(Object.values(MARKS)));
  const bone = new Mesh(bones, new MeshStandardMaterial());
  bone.name = "bones";
  bone.userData = { system: "musculoskeletal", layer: "bone" };
  const organs = new BufferGeometry();
  organs.setAttribute("position", triangles([LIVER]));
  const liver = new Mesh(organs, new MeshStandardMaterial());
  liver.name = "liver";
  liver.userData = { system: "digestive", layer: "organ" };
  root.add(hull, bone, liver);
  const prepared = prepareAtlas(root, ATLASES.bodyparts3d);
  const segments = segmentsFromSkin(prepared.hull, joints);
  if (!segments) throw new Error("synthetic atlas not measured");
  const skinned = skinAtlas(prepared, segments);
  const part = (name: string): FittedMesh =>
    skinned.atlas.parts.find((item) => item.mesh.name === name)!.mesh as FittedMesh;
  return { ...skinned, bones: part("bones"), liver: part("liver") };
};

/** Where the skeleton puts corner `corner` of the triangle `index` of a mesh, as the GPU would. */
const shown = (mesh: FittedMesh, index: number, corner = 0): Vector3 =>
  mesh
    .getVertexPosition(3 * index + corner, new Vector3())
    .applyMatrix4(mesh.matrixWorld);

const settle = (
  root: Object3D,
  meshes: readonly FittedMesh[],
  skeletons: FitSkeletons,
): void => {
  root.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.updateMatrixWorld(true);
  skeletons.soft.update();
  skeletons.bone.update();
};

/** A scan off centre and turned a quarter of the way round. */
const FRAMING = new Matrix4()
  .makeTranslation(0.5, 0.3, 0)
  .multiply(new Matrix4().makeRotationZ(0.8));

describe("the segment fit on a synthetic scan", () => {
  const { skeletons, fit, bones, liver } = syntheticAtlas();
  const { held, segments } = fit;
  const meshes = [bones, liver];
  const scan = syntheticScan(HEAVY_FIGURE, FRAMING);
  const binding = bindRig(scan.root)!;
  const body = readBody(scan.root, binding)!;
  const toWorld = (point: Vector3): Vector3 =>
    point.clone().applyMatrix4(scan.root.matrixWorld);
  const boneAt = (name: string): Vector3 =>
    scan.root.getObjectByName(`mixamorig${name}`)!.getWorldPosition(new Vector3());
  const mark = (name: keyof typeof MARKS, corner = 0): Vector3 =>
    shown(bones, MARK_NAMES.indexOf(name), corner);
  const lay = (): void => {
    followWith(skeletons, followBody(fit, body)!);
    settle(scan.root, meshes, skeletons);
  };

  test("skins every part and its depth pre-pass, and says which segments hold anatomy", () => {
    expect(bones).toBeInstanceOf(FittedMesh);
    expect(depthPrepassOf(bones)).toBeInstanceOf(FittedMesh);
    expect(bones.frustumCulled).toBe(false);
    // Bones on a skeleton of their own, soft tissue on the other.
    expect(bones.skeleton).toBe(skeletons.bone);
    expect(liver.skeleton).toBe(skeletons.soft);
    expect([...held].map((index) => SEGMENT_IDS[index]).sort()).toContain("abdomen");
    expect(held.has(SEGMENT_IDS.indexOf("upperArmL"))).toBe(false);
  });

  test("reads the scan's joints and outline whatever its framing", () => {
    expect(binding.kind).toBe("mixamo");
    expect(body.segments.thighL.halfWidth).toBeCloseTo(HEAVY_FIGURE.radius.thigh, 2);
    expect(body.segments.abdomen.halfDepth).toBeCloseTo(HEAVY_FIGURE.abdomen[1], 2);
    expect(
      body.segments.shinL.origin.distanceTo(toWorld(scan.figure.joints.knee.L)),
    ).toBeLessThan(0.01);
    expect(body.drive[SEGMENT_IDS.indexOf("forearmR")]!.name).toBe(
      "mixamorigRightForeArm",
    );
  });

  test("lays the atlas on the scan: every end under 1 cm from the body's", () => {
    lay();
    const ends: readonly (readonly [keyof typeof MARKS, Vector3])[] = [
      ["kneeL", boneAt("LeftLeg")],
      ["wristL", boneAt("LeftHand")],
      ["wristR", boneAt("RightHand")],
      ["ankleL", boneAt("LeftFoot")],
      ["ankleR", boneAt("RightFoot")],
      ["toeL", toWorld(scan.figure.toe.L)],
      ["toeR", toWorld(scan.figure.toe.R)],
      ["fingerL", toWorld(scan.figure.finger.L)],
      ["fingerR", toWorld(scan.figure.finger.R)],
      ["crown", toWorld(crownOf(HEAVY_FIGURE))],
    ];
    for (const [name, target] of ends) {
      expect({ name, off: mark(name).distanceTo(target) < 0.01 }).toEqual({
        name,
        off: true,
      });
    }
  });

  test("bones keep their proportions: a femur and a humerus as wide as long", () => {
    lay();
    const width = (name: keyof typeof MARKS): number =>
      mark(name, 1).distanceTo(mark(name, 0)) / EDGE;
    const ratio = (measured: number, wanted: number): number => measured / wanted;
    // The heavy figure's thighs are a third thicker but 12 % shorter.
    expect(
      Math.abs(ratio(width("midThighL"), HEAVY_FIGURE.thigh / AVERAGE_FIGURE.thigh) - 1),
    ).toBeLessThan(0.02);
    expect(
      Math.abs(
        ratio(width("midUpperArmR"), HEAVY_FIGURE.upperArm / AVERAGE_FIGURE.upperArm) - 1,
      ),
    ).toBeLessThan(0.02);
  });

  test("organs follow the skin: the liver lands inside the heavy figure's abdomen", () => {
    lay();
    // Further from the midline and further forward than in the atlas.
    const placed = shown(liver, 0).applyMatrix4(scan.root.matrixWorld.clone().invert());
    expect(placed.x).toBeLessThan(LIVER.x);
    expect(Math.abs(placed.x)).toBeLessThan(HEAVY_FIGURE.abdomen[0]);
    expect(placed.z).toBeGreaterThan(LIVER.z);
    expect(placed.z).toBeLessThan(HEAVY_FIGURE.belly + HEAVY_FIGURE.abdomen[1]);
  });

  test("follows the scan's bones through walk, run and sleep", () => {
    followWith(skeletons, followBody(fit, body)!);
    for (const [clip, t] of [
      ["walk", 0.4],
      ["run", 0.2],
      ["sleep", 1],
    ] as const) {
      applyPose(binding, clipPose(clip, t));
      settle(scan.root, meshes, skeletons);
      expect(mark("kneeL").distanceTo(boneAt("LeftLeg"))).toBeLessThan(0.02);
      // The middle of the shin stays on the line from the knee to the ankle.
      const middle = boneAt("LeftLeg").lerp(boneAt("LeftFoot"), 0.5);
      expect(mark("midShinL").distanceTo(middle)).toBeLessThan(0.02);
    }
    applyPose(binding, clipPose("idle", 0));
  });

  test("a pick hits the atlas where the bones put it", () => {
    lay();
    const [a, b, c] = [0, 1, 2].map((corner) => shown(liver, 0, corner)) as [
      Vector3,
      Vector3,
      Vector3,
    ];
    const target = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    // From the triangle's front, straight at its middle.
    const hits = new Raycaster(target.clone().add(normal), normal.clone().negate())
      .intersectObject(liver, false)
      .filter((hit) => hit.object === liver);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.distanceTo(target)).toBeLessThan(1e-4);
  });

  test("the one-scale fit shows through the same skeletons when the body cannot be read", () => {
    const matrix = new Matrix4().makeTranslation(1, 2, 3);
    followWith(skeletons, followMatrix(matrix));
    settle(scan.root, meshes, skeletons);
    expect(
      mark("kneeL").distanceTo(MARKS.kneeL.clone().applyMatrix4(matrix)),
    ).toBeLessThan(1e-5);
    expect(shown(liver, 0).distanceTo(LIVER.clone().applyMatrix4(matrix))).toBeLessThan(
      1e-5,
    );
  });

  test("reads a scan whose forearm points straight forward", () => {
    const bentScan = syntheticScan(AVERAGE_FIGURE);
    const forearm = bentScan.root.getObjectByName("mixamorigLeftForeArm")!;
    const hand = bentScan.root.getObjectByName("mixamorigLeftHand")!;
    // Turn the forearm onto the scan's front (-Y), the elbow where it was.
    const from = hand
      .getWorldPosition(new Vector3())
      .sub(forearm.getWorldPosition(new Vector3()));
    forearm.applyQuaternion(
      new Quaternion().setFromUnitVectors(from.normalize(), new Vector3(0, -1, 0)),
    );
    const read = readBody(bentScan.root, bindRig(bentScan.root)!)!;
    const segment = read.segments.forearmL;
    expect(segment.axis.y).toBeLessThan(-0.95);
    expect(segment.left.length()).toBeCloseTo(1, 6);
    expect(Math.abs(segment.left.z)).toBeGreaterThan(0.9);
    expect(segment.halfWidth).toBeCloseTo(AVERAGE_FIGURE.radius.forearm, 2);
    expect(segment.halfDepth).toBeCloseTo(AVERAGE_FIGURE.radius.forearm, 2);
    const { ok } = fitMatrices(segments, read.segments, (index) => held.has(index));
    expect(ok).toBe(true);
  });

  test("a scan without hand bones is not read", () => {
    const bare = syntheticScan(AVERAGE_FIGURE);
    const rig = bindRig(bare.root)!;
    expect(readBody(bare.root, { ...rig, hands: { L: null, R: null } })).toBeNull();
  });
});
