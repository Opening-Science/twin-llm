import { describe, expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Raycaster,
  Vector3,
} from "three";

import { ATLASES } from "@/packages/anatomy/manifest";
import {
  AVERAGE_FIGURE,
  HEAVY_FIGURE,
  syntheticFigure,
} from "@/packages/anatomy/fixtures/synthetic-figure";
import { SEGMENT_IDS, segmentsFromSkin } from "@/packages/anatomy/segments";

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
  skinAtlas,
  type FitSkeleton,
} from "./skinned-atlas";

/**
 * A synthetic atlas in the atlas frame: the average figure's skin as the
 * hull, and a "bone" mesh with one small triangle at chosen places.
 */
const atlasFigure = syntheticFigure(AVERAGE_FIGURE);
const MARKS = {
  kneeL: atlasFigure.joints.knee.L,
  wristR: atlasFigure.joints.wrist.R,
  midShinL: atlasFigure.joints.knee.L.clone().lerp(atlasFigure.joints.ankle.L, 0.5),
  liver: new Vector3(-0.06, 0.3 * AVERAGE_FIGURE.trunk, 0.02),
} as const;

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
  bones.setAttribute(
    "position",
    new BufferAttribute(
      Float32Array.from(
        Object.values(MARKS).flatMap((mark) => [
          ...mark.toArray(),
          ...mark
            .clone()
            .add(new Vector3(0.004, 0, 0))
            .toArray(),
          ...mark
            .clone()
            .add(new Vector3(0, 0.004, 0))
            .toArray(),
        ]),
      ),
      3,
    ),
  );
  const bone = new Mesh(bones, new MeshStandardMaterial());
  bone.name = "bones";
  bone.userData = { system: "musculoskeletal", layer: "bone" };
  root.add(hull, bone);
  const prepared = prepareAtlas(root, ATLASES.bodyparts3d);
  const segments = segmentsFromSkin(prepared.hull, atlasFigure.joints);
  if (!segments) throw new Error("synthetic atlas not measured");
  return { ...skinAtlas(prepared, segments), segments };
};

/** Where the skeleton puts the first vertex of mark `index`, as the GPU would. */
const shown = (mesh: FittedMesh, index: number): Vector3 =>
  mesh.getVertexPosition(3 * index, new Vector3()).applyMatrix4(mesh.matrixWorld);

const settle = (root: Object3D, mesh: FittedMesh, skeleton: FitSkeleton): void => {
  root.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  skeleton.update();
};

/** A scan off centre and turned a quarter of the way round. */
const FRAMING = new Matrix4()
  .makeTranslation(0.5, 0.3, 0)
  .multiply(new Matrix4().makeRotationZ(0.8));

describe("the segment fit on a synthetic scan", () => {
  const { atlas, skeleton, held, segments } = syntheticAtlas();
  const mesh = atlas.parts[0]!.mesh as FittedMesh;
  const scan = syntheticScan(HEAVY_FIGURE, FRAMING);
  const binding = bindRig(scan.root)!;
  const body = readBody(scan.root, binding)!;
  const toWorld = (point: Vector3): Vector3 =>
    point.clone().applyMatrix4(scan.root.matrixWorld);
  const boneAt = (name: string): Vector3 =>
    scan.root.getObjectByName(`mixamorig${name}`)!.getWorldPosition(new Vector3());

  test("skins every part and its depth pre-pass, and says which segments hold anatomy", () => {
    expect(mesh).toBeInstanceOf(FittedMesh);
    expect(mesh.name).toBe("bones");
    expect(depthPrepassOf(mesh)).toBeInstanceOf(FittedMesh);
    expect(mesh.frustumCulled).toBe(false);
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

  test("lays the atlas on the scan: joints on joints, organs inside the trunk", () => {
    const following = followBody(segments, body, held)!;
    skeleton.follow(following);
    settle(scan.root, mesh, skeleton);
    const marks = Object.keys(MARKS);
    expect(
      shown(mesh, marks.indexOf("kneeL")).distanceTo(boneAt("LeftLeg")),
    ).toBeLessThan(0.01);
    expect(
      shown(mesh, marks.indexOf("wristR")).distanceTo(boneAt("RightHand")),
    ).toBeLessThan(0.015);
    // The liver lands in the heavy figure's abdomen, further from the midline than in the atlas.
    const liver = shown(mesh, marks.indexOf("liver")).applyMatrix4(
      scan.root.matrixWorld.clone().invert(),
    );
    expect(liver.x).toBeLessThan(MARKS.liver.x);
    expect(Math.abs(liver.x)).toBeLessThan(HEAVY_FIGURE.abdomen[0]);
    expect(liver.z).toBeGreaterThan(MARKS.liver.z);
    expect(liver.z).toBeLessThan(HEAVY_FIGURE.belly + HEAVY_FIGURE.abdomen[1]);
  });

  test("follows the scan's bones through walk, run and sleep", () => {
    skeleton.follow(followBody(segments, body, held)!);
    const marks = Object.keys(MARKS);
    for (const [clip, t] of [
      ["walk", 0.4],
      ["run", 0.2],
      ["sleep", 1],
    ] as const) {
      applyPose(binding, clipPose(clip, t));
      settle(scan.root, mesh, skeleton);
      expect(
        shown(mesh, marks.indexOf("kneeL")).distanceTo(boneAt("LeftLeg")),
      ).toBeLessThan(0.02);
      // The middle of the shin stays on the line from the knee to the ankle.
      const shin = shown(mesh, marks.indexOf("midShinL"));
      const middle = boneAt("LeftLeg").lerp(boneAt("LeftFoot"), 0.5);
      expect(shin.distanceTo(middle)).toBeLessThan(0.02);
    }
    applyPose(binding, clipPose("idle", 0));
  });

  test("a pick hits the atlas where the bones put it", () => {
    skeleton.follow(followBody(segments, body, held)!);
    settle(scan.root, mesh, skeleton);
    const first = 3 * Object.keys(MARKS).indexOf("liver");
    const [a, b, c] = [0, 1, 2].map((corner) =>
      mesh
        .getVertexPosition(first + corner, new Vector3())
        .applyMatrix4(mesh.matrixWorld),
    ) as [Vector3, Vector3, Vector3];
    const target = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    // From the triangle's front, straight at its middle.
    const hits = new Raycaster(target.clone().add(normal), normal.clone().negate())
      .intersectObject(mesh, false)
      .filter((hit) => hit.object === mesh);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.distanceTo(target)).toBeLessThan(1e-4);
  });

  test("the one-scale fit shows through the same skeleton when the body cannot be read", () => {
    const matrix = new Matrix4().makeTranslation(1, 2, 3);
    skeleton.follow(followMatrix(matrix));
    settle(scan.root, mesh, skeleton);
    expect(
      shown(mesh, 0).distanceTo(MARKS.kneeL.clone().applyMatrix4(matrix)),
    ).toBeLessThan(1e-5);
  });

  test("a scan without hand bones is not read", () => {
    const bare = syntheticScan(AVERAGE_FIGURE);
    const rig = bindRig(bare.root)!;
    expect(readBody(bare.root, { ...rig, hands: { L: null, R: null } })).toBeNull();
  });
});
