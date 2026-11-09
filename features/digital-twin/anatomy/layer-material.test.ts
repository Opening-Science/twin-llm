import { describe, expect, test } from "bun:test";
import {
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";

import {
  attachLayerFade,
  blendModeFor,
  createLayerMaterial,
  createLayerUniforms,
  HASH_ALPHA_FLOOR,
  HIGHLIGHT_COLOUR,
  HIGHLIGHT_INTENSITY,
  HIGHLIGHT_TINT,
  isHighlighted,
  LAYER_FADE_CACHE_KEY,
  patchLayerFragment,
  RIM_ONLY_FADE,
  setBlendMode,
  setHighlighted,
} from "./layer-material";

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const compile = (material: MeshStandardMaterial) => {
  const shader = {
    uniforms: {},
    fragmentShader: ShaderLib.standard.fragmentShader,
    vertexShader: ShaderLib.standard.vertexShader,
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
};

describe("three 0.184 shader anchors", () => {
  test("each anchor appears once, alphahash before normals and emissive", () => {
    const source = ShaderLib.standard.fragmentShader;
    expect(count(source, "#include <common>")).toBe(1);
    expect(count(source, "#include <alphahash_fragment>")).toBe(1);
    expect(count(source, "#include <emissivemap_fragment>")).toBe(1);
    const alpha = source.indexOf("#include <alphahash_fragment>");
    expect(alpha).toBeLessThan(source.indexOf("#include <normal_fragment_begin>"));
    expect(alpha).toBeLessThan(source.indexOf("#include <emissivemap_fragment>"));
  });
});

describe("patchLayerFragment", () => {
  test("injects the uniforms, the rim alpha and the rim glow exactly once", () => {
    const patched = patchLayerFragment(ShaderLib.standard.fragmentShader);
    expect(count(patched, "uniform float uLayerAlpha;")).toBe(1);
    expect(count(patched, "float twinRim = 0.0;")).toBe(1);
    expect(count(patched, "totalEmissiveRadiance += uRimColor")).toBe(1);
    expect(patched.indexOf("float twinRim")).toBeLessThan(
      patched.indexOf("#include <alphahash_fragment>"),
    );
  });

  test("a rim-only layer gets a sharper rim and drops near-empty fragments", () => {
    const patched = patchLayerFragment(ShaderLib.standard.fragmentShader);
    const rimOnly = patched.indexOf("#ifdef TWIN_RIM_ONLY");
    expect(rimOnly).toBeGreaterThan(-1);
    expect(patched.slice(rimOnly)).toContain("pow( twinEdge, 3.0 )");
    expect(patched).toContain("pow( twinEdge, 2.2 )");
    // Both discards come before three's hash, so no dither dot survives at low alpha.
    const hash = patched.indexOf("#include <alphahash_fragment>");
    const rimDiscard = patched.indexOf("if ( diffuseColor.a < 0.01 ) discard;");
    const hashDiscard = patched.indexOf(
      `if ( diffuseColor.a < ${HASH_ALPHA_FLOOR.toFixed(2)} ) discard;`,
    );
    expect(rimDiscard).toBeGreaterThan(-1);
    expect(hashDiscard).toBeGreaterThan(-1);
    expect(rimDiscard).toBeLessThan(hash);
    expect(hashDiscard).toBeLessThan(hash);
  });

  test("throws by name when a chunk is missing", () => {
    expect(() => patchLayerFragment("#include <common>\nvoid main(){}")).toThrow(
      "layer-fade-anchor-missing:alphahash",
    );
  });
});

describe("attachLayerFade", () => {
  test("is idempotent: a second attach changes nothing", () => {
    const material = new MeshStandardMaterial();
    const first = createLayerUniforms(0.06);
    expect(attachLayerFade(material, first)).toBe(first);
    expect(attachLayerFade(material, createLayerUniforms(0))).toBe(first);
    const shader = compile(material);
    expect(count(shader.fragmentShader, "uniform float uLayerAlpha;")).toBe(1);
    expect(shader.uniforms.uLayerAlpha).toBe(first.uLayerAlpha);
    expect(material.customProgramCacheKey()).toContain(LAYER_FADE_CACHE_KEY);
  });

  test("skips materials without the standard shader", () => {
    expect(attachLayerFade(new MeshBasicMaterial(), createLayerUniforms(0))).toBeNull();
  });
});

describe("blend modes", () => {
  test("solid only when fully opaque and not faded; scan blends, atlas hashes", () => {
    expect(blendModeFor({ alpha: 1, fade: 0, visible: true }, "atlas")).toBe("solid");
    expect(blendModeFor({ alpha: 1, fade: 0.5, visible: true }, "atlas")).toBe("hash");
    expect(blendModeFor({ alpha: 0.4, fade: 0, visible: true }, "scan")).toBe("blend");
  });

  test("a fully faded atlas layer is rim-only, never dithered", () => {
    expect(blendModeFor({ alpha: 1, fade: 1, visible: true }, "atlas")).toBe("rim");
    expect(blendModeFor({ alpha: 0.3, fade: 1, visible: true }, "atlas")).toBe("rim");
    expect(blendModeFor({ alpha: 1, fade: RIM_ONLY_FADE, visible: true }, "atlas")).toBe(
      "rim",
    );
    expect(
      blendModeFor({ alpha: 1, fade: RIM_ONLY_FADE - 0.01, visible: true }, "atlas"),
    ).toBe("hash");
    // The scan keeps its own blended glass at every fade.
    expect(blendModeFor({ alpha: 1, fade: 1, visible: true }, "scan")).toBe("blend");
  });

  test("rim mode blends after the opaque layers and compiles the rim-only shader", () => {
    const material = createLayerMaterial({
      colour: "#b5584e",
      vertexColors: true,
      uniforms: createLayerUniforms(0),
    });
    const start = material.version;
    expect(setBlendMode(material, "rim")).toBe(true);
    expect(material.version).toBe(start + 1);
    expect(material.transparent).toBe(true);
    expect(material.alphaHash).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(FrontSide);
    expect(material.defines).toHaveProperty("TWIN_RIM_ONLY");
    expect(material.defines).toHaveProperty("STANDARD");

    expect(setBlendMode(material, "hash")).toBe(true);
    expect(material.defines).not.toHaveProperty("TWIN_RIM_ONLY");
    expect(material.alphaHash).toBe(true);
    expect(material.depthWrite).toBe(true);

    setBlendMode(material, "rim");
    expect(setBlendMode(material, "solid")).toBe(true);
    expect(material.defines).not.toHaveProperty("TWIN_RIM_ONLY");
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
  });

  test("setBlendMode recompiles only on a change and restores the original side", () => {
    const material = new MeshStandardMaterial({ side: DoubleSide });
    attachLayerFade(material, createLayerUniforms(0.06));
    const start = material.version;
    expect(setBlendMode(material, "solid")).toBe(false);
    expect(material.version).toBe(start);

    expect(setBlendMode(material, "blend")).toBe(true);
    expect(material.version).toBe(start + 1);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(FrontSide);

    expect(setBlendMode(material, "blend")).toBe(false);
    expect(material.version).toBe(start + 1);

    expect(setBlendMode(material, "solid")).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.side).toBe(DoubleSide);
  });

  test("hash mode turns on alphaHash and keeps depth writes", () => {
    const material = createLayerMaterial({
      colour: "#b5584e",
      vertexColors: true,
      uniforms: createLayerUniforms(0),
    });
    setBlendMode(material, "hash");
    expect(material.alphaHash).toBe(true);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.vertexColors).toBe(true);
  });

  test("solid restores a material that arrived transparent", () => {
    const material = new MeshStandardMaterial({ transparent: true, opacity: 0.8 });
    attachLayerFade(material, createLayerUniforms(0.06));
    setBlendMode(material, "blend");
    setBlendMode(material, "solid");
    expect(material.transparent).toBe(true);
    expect(material.alphaHash).toBe(false);
  });
});

describe("setHighlighted", () => {
  test("glows, then restores the exact original emissive", () => {
    const uniforms = createLayerUniforms(0);
    const material = createLayerMaterial({
      colour: "#d6a06a",
      vertexColors: true,
      uniforms,
    });
    Object.assign(material, { emissiveIntensity: 0.2 });
    material.emissive.set("#102030");
    const tinted = material.color
      .clone()
      .lerp(new Color(HIGHLIGHT_COLOUR), HIGHLIGHT_TINT);
    const key = material.customProgramCacheKey();
    const version = material.version;
    const { color, emissive } = material;

    expect(setHighlighted(material, true)).toBe(true);
    expect(isHighlighted(material)).toBe(true);
    expect(material.emissive.getHexString()).toBe(HIGHLIGHT_COLOUR.slice(1));
    expect(material.emissiveIntensity).toBe(HIGHLIGHT_INTENSITY);
    expect(material.color.equals(tinted)).toBe(true);
    // A uniform change only: same program, no recompile.
    expect(material.customProgramCacheKey()).toBe(key);
    expect(material.version).toBe(version);

    expect(setHighlighted(material, true)).toBe(false);

    expect(setHighlighted(material, false)).toBe(true);
    expect(isHighlighted(material)).toBe(false);
    expect(material.emissive.getHexString()).toBe("102030");
    expect(material.emissiveIntensity).toBe(0.2);
    expect(material.color.getHexString()).toBe("d6a06a");
    expect(setHighlighted(material, false)).toBe(false);
    // Copied into, never swapped: the material keeps its own Color objects.
    expect(material.color).toBe(color);
    expect(material.emissive).toBe(emissive);
  });

  test("leaves materials without an emissive term alone", () => {
    const basic = new MeshBasicMaterial();
    expect(setHighlighted(basic, true)).toBe(false);
    expect(isHighlighted(basic)).toBe(false);
  });

  test("keeps the fade attached while glowing", () => {
    const uniforms = createLayerUniforms(0);
    const material = createLayerMaterial({
      colour: "#c2453b",
      vertexColors: false,
      uniforms,
    });
    setHighlighted(material, true);
    expect(setBlendMode(material, "hash")).toBe(true);
    expect(material.alphaHash).toBe(true);
    expect(material.emissive.getHexString()).toBe(HIGHLIGHT_COLOUR.slice(1));
  });
});
