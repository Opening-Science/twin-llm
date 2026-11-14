import { Box3, Vector3 } from "three";

import { CLEARANCE_M, SPREAD } from "./explode";

/**
 * Where the camera goes to frame one structure, such as the CT skeleton, in
 * the Z-up body frame (front is -Y): a three-quarter front view, turned
 * towards the body's left and a little above, far enough back that the box's
 * bounding sphere fits the narrower of the two fields of view with a margin.
 */
export const THREE_QUARTER_AZIMUTH_DEG = 35;
export const THREE_QUARTER_ELEVATION_DEG = 10;
export const FRAMING_MARGIN = 1.08;

export type Framing = Readonly<{
  position: Vector3;
  target: Vector3;
  near: number;
  far: number;
}>;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * `direction` (from the box towards the camera) keeps a view the person has
 * turned to and only moves the camera in or out, as when the bones spread.
 */
export const threeQuarterFraming = (
  box: Box3,
  fovDeg: number,
  aspect: number,
  direction: Vector3 | null = null,
): Framing | null => {
  if (box.isEmpty() || !(fovDeg > 0) || !(aspect > 0)) return null;
  const target = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.length() / 2, 0.05);
  // Like the body fit, the near plane is a small fixed share of the box, not
  // the gap in front of it, so zooming in never clips the front ribs.
  const span = Math.max(size.x, size.y, size.z, 0.05);
  const vertical = radians(fovDeg);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const half = Math.min(vertical, horizontal) / 2;
  const distance = (radius * FRAMING_MARGIN) / Math.sin(half);
  const azimuth = radians(THREE_QUARTER_AZIMUTH_DEG);
  const elevation = radians(THREE_QUARTER_ELEVATION_DEG);
  const view =
    direction && direction.lengthSq() > 1e-8
      ? direction.clone().normalize()
      : new Vector3(
          Math.sin(azimuth) * Math.cos(elevation),
          -Math.cos(azimuth) * Math.cos(elevation),
          Math.sin(elevation),
        );
  return {
    position: target.clone().addScaledVector(view, distance),
    target,
    near: span / 80,
    far: distance + radius * 20,
  };
};

/**
 * The space spread bones can take at slider value t: every centre moves out by
 * at most SPREAD × t of its distance plus the clearance, so the box grows by
 * that much about its middle. A little larger than the bones need, never smaller.
 */
export const spreadBox = (box: Box3, t: number): Box3 => {
  const amount = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  if (box.isEmpty() || amount === 0) return box;
  const centre = box.getCenter(new Vector3());
  const half = box
    .getSize(new Vector3())
    .multiplyScalar(0.5 * (1 + SPREAD * amount))
    .addScalar(CLEARANCE_M * amount);
  return new Box3(centre.clone().sub(half), centre.clone().add(half));
};
