"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BackSide,
  Box3,
  CircleGeometry,
  Color,
  type Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";

import { GROUND_RADIUS_M, type WorldLook } from "./environment-look";

/**
 * The world around the body: a sky dome and a ground disc, both unlit shaders.
 * No shadow maps and no scene fog: the contact shadow is the existing floor
 * pool, and the fog is a fade inside these two shaders, so the body's own
 * materials are never recompiled or changed.
 *
 * Draw order, all without depth writes: sky (-3), ground (-2), floor pool (-1),
 * then the body. The sky is a unit sphere drawn around the camera at the far
 * plane, so no camera distance can clip it.
 */

/** The ground sits under the floor pool (3 mm under the soles), so the two never z-fight. */
export const GROUND_DROP_M = 0.006;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  float up = normalize(vDir).z;
  float t = pow(smoothstep(0.0, 0.65, up), 0.8);
  gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
  #include <colorspace_fragment>
}
`;

const GROUND_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GROUND_FRAGMENT = /* glsl */ `
uniform vec3 uGround;
uniform vec3 uHorizon;
uniform vec3 uGrid;
uniform float uGridAlpha;
uniform float uFogNear;
uniform float uFogFar;
uniform vec2 uCenter;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xy;
  vec2 cell = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(cell.x, cell.y), 1.0);
  vec3 colour = mix(uGround, uGrid, line * uGridAlpha);
  float fog = smoothstep(uFogNear, uFogFar, distance(p, uCenter));
  gl_FragColor = vec4(mix(colour, uHorizon, fog), 1.0);
  #include <colorspace_fragment>
}
`;

export type GroundPlacement = Readonly<{ x: number; y: number; z: number }>;

/** Centred under the body, just below its lowest point (Z-up scene). */
export const groundPlacement = (box: Box3): GroundPlacement | null => {
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  return { x: center.x, y: center.y, z: box.min.z - GROUND_DROP_M };
};

export const EnvironmentWorld = ({
  object,
  world,
}: Readonly<{ object: Object3D; world: WorldLook }>) => {
  const invalidate = useThree((state) => state.invalidate);
  const placement = useMemo(
    () => groundPlacement(new Box3().setFromObject(object)),
    [object],
  );
  const parts = useMemo(() => {
    const sky = {
      uTop: { value: new Color() },
      uHorizon: { value: new Color() },
    };
    const ground = {
      uGround: { value: new Color() },
      uHorizon: sky.uHorizon,
      uGrid: { value: new Color() },
      uGridAlpha: { value: 0 },
      uFogNear: { value: 0 },
      uFogFar: { value: 1 },
      uCenter: { value: new Vector2() },
    };
    return {
      sky,
      ground,
      skyGeometry: new SphereGeometry(1, 48, 24),
      groundGeometry: new CircleGeometry(GROUND_RADIUS_M, 96),
      skyMaterial: new ShaderMaterial({
        uniforms: sky,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: BackSide,
        depthWrite: false,
        depthTest: false,
      }),
      groundMaterial: new ShaderMaterial({
        uniforms: ground,
        vertexShader: GROUND_VERTEX,
        fragmentShader: GROUND_FRAGMENT,
        depthWrite: false,
      }),
    };
  }, []);

  useEffect(
    () => () => {
      parts.skyGeometry.dispose();
      parts.groundGeometry.dispose();
      parts.skyMaterial.dispose();
      parts.groundMaterial.dispose();
    },
    [parts],
  );

  // The look is rebuilt every clock minute; only a real change of a value
  // redraws, so a night that holds still draws nothing.
  const { skyTop, horizon, ground: groundHex, grid, gridAlpha, fogNear, fogFar } = world;
  useEffect(() => {
    const { sky, ground } = parts;
    // Uniforms are three.js objects read by the shaders each draw; set them in place.
    sky.uTop.value.setHex(skyTop);
    sky.uHorizon.value.setHex(horizon);
    ground.uGround.value.setHex(groundHex);
    ground.uGrid.value.setHex(grid);
    ground.uCenter.value.set(placement?.x ?? 0, placement?.y ?? 0);
    Object.assign(ground.uGridAlpha, { value: gridAlpha });
    Object.assign(ground.uFogNear, { value: fogNear });
    Object.assign(ground.uFogFar, { value: fogFar });
    invalidate();
  }, [
    parts,
    skyTop,
    horizon,
    groundHex,
    grid,
    gridAlpha,
    fogNear,
    fogFar,
    placement,
    invalidate,
  ]);

  return (
    <>
      <mesh
        geometry={parts.skyGeometry}
        material={parts.skyMaterial}
        frustumCulled={false}
        renderOrder={-3}
      />
      {placement ? (
        <mesh
          geometry={parts.groundGeometry}
          material={parts.groundMaterial}
          position={[placement.x, placement.y, placement.z]}
          renderOrder={-2}
        />
      ) : null}
    </>
  );
};
