import { type Box3, Matrix4, type Vector3 } from "three";

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

export type AtlasFit = Readonly<{
  matrix: Matrix4;
  scale: number;
  anchor: "hips" | "bbox";
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
