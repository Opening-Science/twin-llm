"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  Box3,
  Color,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

/**
 * A soft contact pool under the feet so the body stands on something instead
 * of floating in the canvas. It is a radial gradient on a plane, not a shadow
 * map: shadow maps would cost a second pass on every frame for a cue this
 * small. The plane sits a few millimetres under the floor so it never
 * z-fights the soles, and it does not write depth so glass layers still blend.
 */
export const FLOOR_POOL_DROP_M = 0.003;
const POOL_RADIUS_FACTOR = 0.8;

export type FloorPoolPlacement = Readonly<{
  x: number;
  y: number;
  z: number;
  radius: number;
}>;

export const floorPoolPlacement = (box: Box3): FloorPoolPlacement | null => {
  if (box.isEmpty()) return null;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  return {
    x: center.x,
    y: center.y,
    z: box.min.z - FLOOR_POOL_DROP_M,
    radius: Math.max(size.x, size.y) * POOL_RADIUS_FACTOR,
  };
};

export type FloorPoolTint = Readonly<{ color: number; opacity: number }>;

/** Black reads as contact on the dark hero; on light, black at that strength looks like a hole. */
export const floorPoolTint = (dark: boolean): FloorPoolTint =>
  dark ? { color: 0x000000, opacity: 0.55 } : { color: 0x334155, opacity: 0.22 };

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(uTint, a);
}
`;

export const FloorPool = ({
  object,
  dark,
}: Readonly<{ object: Object3D; dark: boolean }>) => {
  const invalidate = useThree((state) => state.invalidate);
  const placement = useMemo(
    () => floorPoolPlacement(new Box3().setFromObject(object)),
    [object],
  );
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const { material, uniforms } = useMemo(() => {
    const shared = { uTint: { value: new Color() }, uOpacity: { value: 0 } };
    return {
      uniforms: shared,
      material: new ShaderMaterial({
        uniforms: shared,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEffect(() => {
    const tint = floorPoolTint(dark);
    // Uniforms are three.js objects read by the shader each draw; set them in place.
    uniforms.uTint.value.setHex(tint.color);
    Object.assign(uniforms.uOpacity, { value: tint.opacity });
    invalidate();
  }, [dark, uniforms, invalidate]);

  if (!placement) return null;
  const diameter = placement.radius * 2;
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[placement.x, placement.y, placement.z]}
      scale={[diameter, diameter, 1]}
      renderOrder={-1}
    />
  );
};
