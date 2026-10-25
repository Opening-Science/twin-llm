"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type PerspectiveCamera, type Vector3 } from "three";
import { type OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { isWalkCode, walkIntent, walkStep } from "./walk";

/** The element that takes keyboard focus for walking (the environment's 3D view). */
export const WALK_SURFACE_ATTR = "data-walk-surface";

/**
 * WASD and the arrow keys while the 3D view has focus. Frames render on
 * demand, so a held key asks for the next frame and the last release stops
 * asking: walking draws only while someone walks. Keys typed into the panel
 * search, sliders or selects never reach it.
 */
export const WalkControls = ({
  enabled,
  camera,
  center,
  getControls,
  onWalk,
}: Readonly<{
  enabled: boolean;
  camera: PerspectiveCamera;
  /** The body's centre; the orbit target stays within the walk radius of it. */
  center: Vector3 | null;
  getControls: () => OrbitControls | null;
  /** First step of a walk, so auto-rotate pauses like it does for a drag. */
  onWalk: () => void;
}>) => {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const held = useRef(new Set<string>());

  useEffect(() => {
    const keys = held.current;
    if (!enabled) return;
    const surface = gl.domElement.closest<HTMLElement>(`[${WALK_SURFACE_ATTR}]`);
    if (!surface) return;
    const onDown = (event: KeyboardEvent) => {
      if (event.target !== surface || !isWalkCode(event.code)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (keys.size === 0) onWalk();
      keys.add(event.code);
      invalidate();
    };
    const onUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    // A key released elsewhere (focus moved, window left) must not keep walking.
    const release = () => keys.clear();
    surface.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    surface.addEventListener("blur", release);
    window.addEventListener("blur", release);
    return () => {
      release();
      surface.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
      surface.removeEventListener("blur", release);
      window.removeEventListener("blur", release);
    };
  }, [enabled, gl, invalidate, onWalk]);

  useFrame((_, delta) => {
    if (held.current.size === 0) return;
    const controls = getControls();
    if (!controls || !center) return;
    const intent = walkIntent(held.current);
    const next = walkStep({
      pose: {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      },
      intent,
      dt: delta,
      center: [center.x, center.y],
    });
    // Camera and target are three.js vectors the controls read each update; moved in place.
    camera.position.set(...next.position);
    controls.target.set(...next.target);
    controls.update();
    invalidate();
  });

  return null;
};
