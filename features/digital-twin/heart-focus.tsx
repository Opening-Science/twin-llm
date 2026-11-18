"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type Box3, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { type OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { fitCameraToBox } from "./scan-scene";

export const HEART_FOCUS_SECONDS = 0.65;
export const BODY_RESET_SECONDS = 0.85;

export type CameraFocusRequest = Readonly<{ kind: "heart" | "body"; box: Box3 }>;

export type CameraFocus = Readonly<{
  fromPosition: Vector3;
  fromTarget: Vector3;
  position: Vector3;
  target: Vector3;
  orbit?: boolean;
}>;

/** Fit a padded heart sphere using the narrower field of view, preserving the viewing angle. */
export const heartCameraFocus = (
  camera: PerspectiveCamera,
  controls: OrbitControls,
  box: Box3,
): CameraFocus => {
  const target = box.getCenter(new Vector3());
  const radius = box.getSize(new Vector3()).length() / 2;
  const halfVertical = MathUtils.degToRad(camera.getEffectiveFOV()) / 2;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const distance = MathUtils.clamp(
    (radius * 1.25) / Math.sin(Math.min(halfVertical, halfHorizontal)),
    controls.minDistance,
    controls.maxDistance,
  );
  const direction = camera.position.clone().sub(controls.target).normalize();
  return {
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    position: target.clone().addScaledVector(direction, distance),
    target,
  };
};

/** Compute the normal full-body framing without moving the live camera yet. */
export const bodyCameraFocus = (
  camera: PerspectiveCamera,
  controls: OrbitControls,
  box: Box3,
): CameraFocus => {
  const fitted = camera.clone();
  const target = fitCameraToBox(fitted, box);
  return {
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    position: fitted.position.clone(),
    target,
    orbit: true,
  };
};

export const applyHeartFocus = (
  camera: PerspectiveCamera,
  controls: OrbitControls,
  focus: CameraFocus,
  progress: number,
): void => {
  const t = MathUtils.clamp(progress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  controls.target.lerpVectors(focus.fromTarget, focus.target, eased);
  if (focus.orbit) {
    // Follow an arc while pulling back, rather than cutting through the body from behind.
    const from = focus.fromPosition.clone().sub(focus.fromTarget);
    const to = focus.position.clone().sub(focus.target);
    const distance = MathUtils.lerp(from.length(), to.length(), eased);
    const rotation = new Quaternion().setFromUnitVectors(
      from.normalize(),
      to.normalize(),
    );
    from.applyQuaternion(new Quaternion().slerp(rotation, eased));
    camera.position.copy(controls.target).addScaledVector(from, distance);
  } else {
    camera.position.lerpVectors(focus.fromPosition, focus.position, eased);
  }
  const damping = controls.enableDamping;
  Object.assign(controls, { enableDamping: false, autoRotate: false });
  controls.update(0);
  Object.assign(controls, { enableDamping: damping });
};

/** Frame the heart or return to the body; clearing a request cancels without snapping. */
export const HeartFocus = ({
  request,
  getControls,
  reducedMotion,
}: Readonly<{
  request: CameraFocusRequest | null;
  getControls: () => OrbitControls | null;
  reducedMotion: boolean;
}>) => {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const transition = useRef<{ focus: CameraFocus; elapsed: number } | null>(null);
  const done = useRef(false);
  useEffect(() => {
    transition.current = null;
    done.current = false;
    invalidate();
  }, [request, invalidate]);
  useFrame((_, delta) => {
    if (!request || done.current || !(camera instanceof PerspectiveCamera)) return;
    const controls = getControls();
    if (!controls) return;
    if (!transition.current) {
      const damping = controls.enableDamping;
      Object.assign(controls, { enableDamping: false, autoRotate: false });
      controls.update(0);
      Object.assign(controls, { enableDamping: damping });
      transition.current = {
        focus:
          request.kind === "heart"
            ? heartCameraFocus(camera, controls, request.box)
            : bodyCameraFocus(camera, controls, request.box),
        elapsed: 0,
      };
    }
    const next = transition.current;
    next.elapsed += Math.min(delta, 0.05);
    const duration = request.kind === "heart" ? HEART_FOCUS_SECONDS : BODY_RESET_SECONDS;
    const progress = reducedMotion ? 1 : Math.min(1, next.elapsed / duration);
    applyHeartFocus(camera, controls, next.focus, progress);
    done.current = progress === 1;
    if (!done.current) invalidate();
  });
  return null;
};
