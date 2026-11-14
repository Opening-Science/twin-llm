import { type Box3, Matrix4, Quaternion, Vector3 } from "three";

import { type HorizontalPoint } from "./manifest";

/**
 * Places a reference atlas inside a BodyLoop scan.
 *
 * Atlas frame (glTF): metres, +Y up, faces +Z, +X the subject's left.
 * Scan frame (BodyLoop): metres, +Z up, faces -Y, +X the subject's left, floor at z=0.
 * Rx(+90°) maps up → +Z, front → -Y and keeps left on +X (det +1), so no mirror.
 *
 * The fit is deliberately simple and says so in the UI: one uniform scale from
 * height (the scan's measured stature when it has one, else its box, which
 * includes hair), feet on the scan's floor, and hips aligned horizontally. It does not
 * bend limbs or move organs; a reference anatomy is not the scanned person's.
 */
export const MIN_FIT_SCALE = 0.5;
export const MAX_FIT_SCALE = 1.6;

export const atlasToScanRotation = (): Matrix4 =>
  new Matrix4().makeRotationX(Math.PI / 2);

export type AtlasFrame = Readonly<{
  /**
   * Atlas box in its own frame: height (y) from the whole scene, skin included;
   * x and z from the parts that are kept, so dropped parts do not shift it.
   */
  box: Box3;
  hipAnchor: HorizontalPoint | null;
  mirrorX: boolean;
}>;

export type ScanFrame = Readonly<{
  box: Box3;
  floorZ: number;
  height: number;
  /** Measured stature in metres (floor to vertex), when the scan has a plausible one. */
  stature: number | null;
  /** Midpoint of the two hip joints in scan coordinates, when the skeleton has them. */
  hipMidpoint: Vector3 | null;
}>;

/**
 * How the atlas was placed: at the hips or the box centre by the scale-and-
 * centre fit, or with the body's own transform when it was refitted to the
 * body in Blender (`placeFittedAtlas`).
 */
export type AtlasAnchor = "hips" | "bbox" | "body";

export type AtlasFit = Readonly<{
  matrix: Matrix4;
  scale: number;
  anchor: AtlasAnchor;
  ok: boolean;
}>;

export const fitAtlasToScan = (atlas: AtlasFrame, scan: ScanFrame): AtlasFit => {
  const atlasHeight = atlas.box.max.y - atlas.box.min.y;
  const scale = (scan.stature ?? scan.height) / atlasHeight;
  const ok =
    !atlas.box.isEmpty() &&
    !scan.box.isEmpty() &&
    Number.isFinite(scale) &&
    scale >= MIN_FIT_SCALE &&
    scale <= MAX_FIT_SCALE;
  const anchor = atlas.hipAnchor && scan.hipMidpoint ? "hips" : "bbox";
  if (!ok) return { matrix: new Matrix4(), scale, anchor, ok };

  // Same anatomical point on both sides, or both bbox centres; never mixed.
  const atlasPoint: HorizontalPoint =
    anchor === "hips" && atlas.hipAnchor
      ? atlas.hipAnchor
      : {
          x: (atlas.box.min.x + atlas.box.max.x) / 2,
          z: (atlas.box.min.z + atlas.box.max.z) / 2,
        };
  const scanX =
    anchor === "hips" && scan.hipMidpoint
      ? scan.hipMidpoint.x
      : (scan.box.min.x + scan.box.max.x) / 2;
  const scanY =
    anchor === "hips" && scan.hipMidpoint
      ? scan.hipMidpoint.y
      : (scan.box.min.y + scan.box.max.y) / 2;

  const mirror = atlas.mirrorX ? -1 : 1;
  // After scale and rotation an atlas point (x, y, z) lands at (s·m·x, -s·z, s·y).
  const tx = scanX - scale * mirror * atlasPoint.x;
  const ty = scanY + scale * atlasPoint.z;
  const tz = scan.floorZ - scale * atlas.box.min.y;

  const matrix = new Matrix4()
    .makeTranslation(tx, ty, tz)
    .multiply(atlasToScanRotation())
    .multiply(new Matrix4().makeScale(scale * mirror, scale, scale));
  return { matrix, scale, anchor, ok };
};

/**
 * Where the hip joints sit in a pair of hip bones, as a share of their height
 * from the bottom: the acetabulum is about a third of the way up from the
 * ischial tuberosity. An estimate, and the panel says the fit is approximate.
 */
export const ACETABULUM_SHARE = 0.35;
/** Hip joints at about 0.53 of the body's height, when the scan has no rig. */
export const HIP_HEIGHT_SHARE = 0.53;

export type SkeletonFrame = Readonly<{
  /** The whole skeleton's box in its own frame (glTF: metres, +Y up, faces +Z). */
  box: Box3;
  /** The two hip bones' box, when the file has them. */
  hipBox: Box3 | null;
  /**
   * The spine's axis in the file's frame, top (T1) and bottom (L5, else the
   * sacrum) centroids, when the file has them; the fit stands it upright.
   */
  spine: Readonly<{ top: Vector3; bottom: Vector3 }> | null;
}>;

export type SkeletonFit = Readonly<{
  matrix: Matrix4;
  anchor: "hips" | "bbox";
  ok: boolean;
}>;

/**
 * The turn that stands a spine upright: its bottom-to-top axis onto +Y, the
 * smallest turn that does it, so the front keeps facing +Z. A CT is taken
 * lying down, and on s0086 the T1 to L5 axis leans back from the scanner's
 * own head-foot axis, so the rib cage tilted and the pelvis came forward.
 */
export const uprightRotation = (
  spine: Readonly<{ top: Vector3; bottom: Vector3 }> | null,
): Quaternion => {
  if (!spine) return new Quaternion();
  const axis = new Vector3().subVectors(spine.top, spine.bottom);
  if (axis.lengthSq() < 1e-8) return new Quaternion();
  return new Quaternion().setFromUnitVectors(axis.normalize(), new Vector3(0, 1, 0));
};

/**
 * Places a CT skeleton at its own size: CT is measured in metres, so it is not
 * scaled to the body. Its spine stands upright (T1 over L5), and its hip
 * joints (estimated from the hip bones) go to the scan's hip joints, or to
 * 0.53 of the body's height in the middle of its box when the scan has no rig.
 * A trunk-only skeleton has no feet for the floor.
 */
export const fitSkeletonToScan = (
  skeleton: SkeletonFrame,
  scan: ScanFrame,
): SkeletonFit => {
  const ok = !skeleton.box.isEmpty() && !scan.box.isEmpty() && scan.height > 0;
  const anchor = skeleton.hipBox && scan.hipMidpoint ? "hips" : "bbox";
  if (!ok) return { matrix: new Matrix4(), anchor, ok };
  const from = skeleton.hipBox ?? skeleton.box;
  const upright = uprightRotation(skeleton.spine);
  const point = new Vector3(
    (from.min.x + from.max.x) / 2,
    skeleton.hipBox
      ? from.min.y + ACETABULUM_SHARE * (from.max.y - from.min.y)
      : (from.min.y + from.max.y) / 2,
    (from.min.z + from.max.z) / 2,
  ).applyQuaternion(upright);
  const target =
    anchor === "hips" && scan.hipMidpoint
      ? { x: scan.hipMidpoint.x, y: scan.hipMidpoint.y, z: scan.hipMidpoint.z }
      : {
          x: (scan.box.min.x + scan.box.max.x) / 2,
          y: (scan.box.min.y + scan.box.max.y) / 2,
          z: scan.floorZ + HIP_HEIGHT_SHARE * scan.height,
        };
  // Rx(+90°) takes a file point (x, y, z) to (x, -z, y).
  const matrix = new Matrix4()
    .makeTranslation(target.x - point.x, target.y + point.z, target.z - point.y)
    .multiply(atlasToScanRotation())
    .multiply(new Matrix4().makeRotationFromQuaternion(upright));
  return { matrix, anchor, ok };
};

/**
 * A refitted atlas's height may differ from the body's by this much at most:
 * Blender scales it to the body's height, feet on its floor, so a file made
 * for another body (1.772 m against 1.914 m is 0.93) is refused.
 */
export const FITTED_HEIGHT_BAND: readonly [number, number] = [0.97, 1.03];

/**
 * Places an atlas refitted to a rigged demo body (#525). Blender wrote it in
 * the body's own frame at its bind pose, so it takes the body's world
 * transform as it is (for the demo body, the same Rx(+90°) into the scan
 * frame): no scale from height, no centring. `body.frame` is the body's box
 * in the bind pose (`readScanFrame`); the fit is refused when the atlas is
 * not about the body's height in that frame.
 */
export const placeFittedAtlas = (
  atlasBox: Box3,
  body: Readonly<{ matrixWorld: Matrix4; frame: ScanFrame }>,
): AtlasFit => {
  const scale = new Vector3().setFromMatrixScale(body.matrixWorld);
  const atlasHeight = (atlasBox.max.y - atlasBox.min.y) * scale.y;
  const ratio = atlasHeight / body.frame.height;
  const ok =
    !atlasBox.isEmpty() &&
    !body.frame.box.isEmpty() &&
    Number.isFinite(ratio) &&
    ratio >= FITTED_HEIGHT_BAND[0] &&
    ratio <= FITTED_HEIGHT_BAND[1];
  return {
    matrix: ok ? body.matrixWorld.clone() : new Matrix4(),
    scale: scale.y,
    anchor: "body",
    ok,
  };
};
