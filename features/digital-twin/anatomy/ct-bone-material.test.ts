import { describe, expect, test } from "bun:test";
import { LinearSRGBColorSpace, ShaderLib } from "three";

import {
  CT_LOOK,
  CT_SHADE_CACHE_KEY,
  createCtMaterial,
  patchShadeFragment,
} from "./ct-bone-material";
import {
  createLayerUniforms,
  layerFadeUniforms,
  patchLayerFragment,
} from "./layer-material";

const linear = (material: ReturnType<typeof createCtMaterial>) => {
  const rgb = { r: 0, g: 0, b: 0 };
  material.color.getRGB(rgb, LinearSRGBColorSpace);
  return [rgb.r, rgb.g, rgb.b].map((n) => Math.round(n * 100) / 100);
};

describe("CT bone and cartilage look", () => {
  test("open-anatomy's studio tones: warm ivory bone, blue-white cartilage", () => {
    const uniforms = createLayerUniforms(0);
    const bone = createCtMaterial("bone", uniforms);
    const cartilage = createCtMaterial("cartilage", uniforms);
    expect(linear(bone)).toEqual([0.87, 0.8, 0.66]);
    expect(linear(cartilage)).toEqual([0.76, 0.88, 0.98]);
    expect(bone.roughness).toBe(0.55);
    expect(bone.envMapIntensity).toBe(0.6);
    expect(cartilage.roughness).toBe(0.6);
    // Bone is warm (red over blue), cartilage cool (blue over red).
    expect(CT_LOOK.bone.colour[0]).toBeGreaterThan(CT_LOOK.bone.colour[2]);
    expect(CT_LOOK.cartilage.colour[2]).toBeGreaterThan(CT_LOOK.cartilage.colour[0]);
  });

  test("both fade on the skeleton layer's shared uniforms", () => {
    const uniforms = createLayerUniforms(0);
    expect(layerFadeUniforms(createCtMaterial("bone", uniforms))).toBe(uniforms);
    expect(layerFadeUniforms(createCtMaterial("cartilage", uniforms))).toBe(uniforms);
  });

  test("bone and cartilage compile as their own programs, fade included", () => {
    const uniforms = createLayerUniforms(0);
    const key = createCtMaterial("cartilage", uniforms).customProgramCacheKey();
    expect(key).toContain(`${CT_SHADE_CACHE_KEY}|cartilage`);
    expect(key).toContain("twin-layer-fade-v1");
  });
});

describe("patchShadeFragment", () => {
  const source = ShaderLib.physical.fragmentShader;

  test("shades turning edges after lighting, and the fade patch still applies", () => {
    const patched = patchShadeFragment(source);
    expect(patched).toContain("uniform vec3 uCtShade;");
    const shade = patched.indexOf("outgoingLight *= mix( vec3( 1.0 ), ctShadeRatio");
    expect(shade).toBeGreaterThan(patched.indexOf("#include <lights_fragment_end>"));
    expect(shade).toBeLessThan(patched.indexOf("#include <opaque_fragment>"));
    const both = patchLayerFragment(patched);
    expect(both).toContain("uniform float uLayerFade;");
  });

  test("a three upgrade that moves an anchor fails loudly", () => {
    expect(() => patchShadeFragment("void main() {}")).toThrow(
      "ct-shade-anchor-missing:common",
    );
  });
});
