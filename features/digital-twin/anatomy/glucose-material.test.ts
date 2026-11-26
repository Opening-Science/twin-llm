import { describe, expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";

import {
  attachDepthPrepass,
  createDepthPrepassMaterial,
  depthPrepassOf,
  setLayerPasses,
} from "./depth-prepass";
import { FOCUS_HEART_OPACITY, FOCUS_VESSEL_OPACITY } from "./organ-focus";
import {
  attachGlucoseHeartOpacity,
  patchGlucoseHeartShaders,
  setGlucoseHeartOpacity,
} from "./glucose-material";
import { createLayerMaterial, createLayerUniforms, setBlendMode } from "./layer-material";

const taggedMesh = () => {
  const root = new Group();
  root.userData.structures = [
    { system: "cardiovascular", ontologyid: "FMA:9553" },
    { system: "cardiovascular", ontologyid: "FMA:4712" },
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(18), 3));
  geometry.setAttribute(
    "_structure",
    new BufferAttribute(new Uint16Array([0, 0, 0, 1, 1, 1]), 1),
  );
  const material = createLayerMaterial({
    colour: "#c2453b",
    vertexColors: false,
    uniforms: createLayerUniforms(0),
  });
  const mesh = new Mesh(geometry, material);
  root.add(mesh);
  return mesh;
};

describe("glucose heart opacity", () => {
  test("uses tagged heart vertices and composes with the existing layer shader", () => {
    const mesh = taggedMesh();
    attachGlucoseHeartOpacity(mesh);
    const attribute = mesh.geometry.getAttribute("glucoseHeart");
    expect([...attribute.array]).toEqual([1, 1, 1, 0, 0, 0]);
    attachGlucoseHeartOpacity(mesh);
    expect(mesh.geometry.getAttribute("glucoseHeart")).toBe(attribute);
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    } as WebGLProgramParametersWithUniforms;
    mesh.material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain("vGlucoseHeart = glucoseHeart;");
    expect(shader.fragmentShader).toContain("uniform float uGlucoseHeartActive;");
    expect(shader.fragmentShader).toContain(
      (FOCUS_HEART_OPACITY / FOCUS_VESSEL_OPACITY).toFixed(8),
    );
    expect(shader.fragmentShader).toContain("uniform float uLayerAlpha;");
    expect(shader.uniforms.uGlucoseHeartActive.value).toBe(0);
    setGlucoseHeartOpacity(mesh.material, true);
    expect(shader.uniforms.uGlucoseHeartActive.value).toBe(1);
    expect(FOCUS_HEART_OPACITY).toBe(0.9);
    expect(FOCUS_HEART_OPACITY).toBeGreaterThan(FOCUS_VESSEL_OPACITY);
    setGlucoseHeartOpacity(mesh.material, false);
    expect(shader.uniforms.uGlucoseHeartActive.value).toBe(0);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  test("glucose blending bypasses the organ prepass and restores it outside glucose mode", () => {
    const mesh = taggedMesh();
    attachDepthPrepass(mesh, createDepthPrepassMaterial());
    setLayerPasses(mesh, "organs", "fade");
    expect(depthPrepassOf(mesh)?.visible).toBe(true);
    setBlendMode(mesh.material, "blend");
    setLayerPasses(mesh, "organs", "blend");
    expect(depthPrepassOf(mesh)?.visible).toBe(false);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthTest).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    setBlendMode(mesh.material, "solid");
    setLayerPasses(mesh, "organs", "solid");
    expect(mesh.material.transparent).toBe(false);
    expect(mesh.material.depthWrite).toBe(true);
    setLayerPasses(mesh, "organs", "fade");
    expect(depthPrepassOf(mesh)?.visible).toBe(true);
  });

  test("fails explicitly if shader anchors change", () => {
    expect(() => patchGlucoseHeartShaders("", ShaderLib.standard.fragmentShader)).toThrow(
      "glucose-heart-anchor-missing",
    );
  });
});
