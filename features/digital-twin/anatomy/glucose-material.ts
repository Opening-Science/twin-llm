import { BufferAttribute, type Material, type Mesh } from "three";

import { FOCUS_HEART_OPACITY, FOCUS_VESSEL_OPACITY } from "./organ-focus";
import { heartVertexMask } from "./heart-geometry";

const states = new WeakMap<Material, { value: number }>();
const COMMON = "#include <common>";
const BEGIN = "#include <begin_vertex>";
const ALPHA = "#include <alphahash_fragment>";

export const patchGlucoseHeartShaders = (
  vertexShader: string,
  fragmentShader: string,
) => {
  for (const [source, anchor] of [
    [vertexShader, COMMON],
    [vertexShader, BEGIN],
    [fragmentShader, COMMON],
    [fragmentShader, ALPHA],
  ]) {
    if (source.split(anchor).length !== 2)
      throw new Error(`glucose-heart-anchor-missing:${anchor}`);
  }
  return {
    vertexShader: vertexShader
      .replace(
        COMMON,
        `${COMMON}\nattribute float glucoseHeart;\nvarying float vGlucoseHeart;`,
      )
      .replace(BEGIN, `${BEGIN}\nvGlucoseHeart = glucoseHeart;`),
    fragmentShader: fragmentShader
      .replace(
        COMMON,
        `${COMMON}\nuniform float uGlucoseHeartActive;\nvarying float vGlucoseHeart;`,
      )
      .replace(
        ALPHA,
        `diffuseColor.a *= mix(1.0, mix(1.0, ${(FOCUS_HEART_OPACITY / FOCUS_VESSEL_OPACITY).toFixed(8)}, vGlucoseHeart), uGlucoseHeartActive);\n${ALPHA}`,
      ),
  };
};

/** BodyParts3D merges heart and vessels: use the existing anatomy IDs, not a spatial guess. */
export const attachGlucoseHeartOpacity = (mesh: Mesh): void => {
  const material = mesh.material;
  if (Array.isArray(material))
    throw new Error("Glucose heart opacity requires one atlas material.");
  if (states.has(material)) return;
  const mask = heartVertexMask(mesh);
  if (!mask) throw new Error("Glucose heart opacity requires tagged heart structures.");
  mesh.geometry.setAttribute(
    "glucoseHeart",
    new BufferAttribute(Float32Array.from(mask), 1),
  );
  const active = { value: 0 };
  states.set(material, active);
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  Object.assign(material, {
    onBeforeCompile: (
      shader: Parameters<Material["onBeforeCompile"]>[0],
      renderer: Parameters<Material["onBeforeCompile"]>[1],
    ) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, { uGlucoseHeartActive: active });
      Object.assign(
        shader,
        patchGlucoseHeartShaders(shader.vertexShader, shader.fragmentShader),
      );
    },
    customProgramCacheKey: () => `${previousKey()}|glucose-heart-alpha-v1`,
    needsUpdate: true,
  });
};

export const setGlucoseHeartOpacity = (material: Material, enabled: boolean): void => {
  const state = states.get(material);
  if (state) Object.assign(state, { value: enabled ? 1 : 0 });
};
