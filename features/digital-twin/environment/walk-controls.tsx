"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type PerspectiveCamera, type Vector3 } from "three";
import { type OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { isTypingTarget, walkIntent, walkKeyApplies, walkStep } from "./walk";

/** The 3D view's element: hovering it or focusing it lets the keys walk. */
export const WALK_SURFACE_ATTR = "data-walk-surface";

/**
 * WASD and the arrow keys while the pointer is over the 3D view or the view
 * has focus, inline and in the environment, with no click first. The keys
 * are heard on the window, so they work wherever focus was left; keys typed
 * into the panel search, sliders, tabs or selects never walk (walk.ts).
 * Frames render on demand, so a held key asks for the next frame and the
 * last release stops asking: walking draws only while someone walks.
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
    // The pointer may already rest on the view when it mounts.
    let pointerOver = surface.matches(":hover");
    const onEnter = () => {
      pointerOver = true;
    };
    const onLeave = () => {
      pointerOver = false;
    };
    const onDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const walks = walkKeyApplies({
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        defaultPrevented: event.defaultPrevented,
        typing: isTypingTarget(target),
        pointerOver,
        focusInside: surface.contains(document.activeElement),
      });
      if (!walks) return;
      // The arrows would scroll the page under the view.
      event.preventDefault();
      if (keys.size === 0) onWalk();
      keys.add(event.code);
      invalidate();
    };
    const onUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    // A key released elsewhere (window left) must not keep walking.
    const release = () => keys.clear();
    surface.addEventListener("pointerenter", onEnter);
    surface.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onDown);
    document.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      release();
      surface.removeEventListener("pointerenter", onEnter);
      surface.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onDown);
      document.removeEventListener("keyup", onUp);
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
