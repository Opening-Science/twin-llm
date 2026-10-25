import { Color, FrontSide, type Material, MeshStandardMaterial, type Side } from "three";

import { type LayerMix } from "@/packages/anatomy/layers";
import { type OrganSystem } from "@/packages/anatomy/systems";

/**
 * The "glass" fade every layer uses, scan included: a small onBeforeCompile
 * patch on MeshStandardMaterial. At fade 0 the surface is unchanged; at fade 1
 * only the silhouette stays opaque (a Fresnel rim), so you see into a layer
 * without losing its outline.
 *
 * In three 0.184 `<alphahash_fragment>` runs before `<normal_fragment_begin>`,
 * so the rim uses `vNormal` / `vViewPosition` directly. The anchors are checked
 * by a test; an upgrade that moves them fails loudly instead of rendering wrong.
 */
export const LAYER_FADE_CACHE_KEY = "twin-layer-fade-v1";

export type LayerUniforms = Readonly<{
  uLayerAlpha: { value: number };
  uLayerFade: { value: number };
  uGlassFloor: { value: number };
  uRimColor: { value: Color };
}>;

/** Glass floor: how opaque a face pointing at the camera stays when fully faded. */
export const createLayerUniforms = (glassFloor: number): LayerUniforms => ({
  uLayerAlpha: { value: 1 },
  uLayerFade: { value: 0 },
  uGlassFloor: { value: glassFloor },
  uRimColor: { value: new Color(0.55, 0.83, 1.0) },
});

const ANCHORS = {
  common: "#include <common>",
  alphahash: "#include <alphahash_fragment>",
  emissive: "#include <emissivemap_fragment>",
} as const;

const DECLARATIONS = `
uniform float uLayerAlpha;
uniform float uLayerFade;
uniform float uGlassFloor;
uniform vec3 uRimColor;`;

const ALPHA = `
float twinRim = 0.0;
#ifndef FLAT_SHADED
  twinRim = pow( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 2.2 );
#endif
diffuseColor.a *= uLayerAlpha * mix( 1.0, mix( uGlassFloor, 0.92, twinRim ), uLayerFade );`;

const RIM = `
totalEmissiveRadiance += uRimColor * twinRim * uLayerFade * uLayerAlpha;`;

/** Pure string patch; throws `layer-fade-anchor-missing:<name>` if three moved a chunk. */
export const patchLayerFragment = (source: string): string => {
  for (const [name, anchor] of Object.entries(ANCHORS)) {
    if (source.split(anchor).length !== 2) {
      throw new Error(`layer-fade-anchor-missing:${name}`);
    }
  }
  return source
    .replace(ANCHORS.common, `${ANCHORS.common}${DECLARATIONS}`)
    .replace(ANCHORS.alphahash, `${ALPHA}\n${ANCHORS.alphahash}`)
    .replace(ANCHORS.emissive, `${ANCHORS.emissive}${RIM}`);
};

const isStandard = (material: Material): material is MeshStandardMaterial =>
  (material as MeshStandardMaterial).isMeshStandardMaterial === true;

type FadeState = Readonly<{
  uniforms: LayerUniforms;
  originalSide: Side;
  originalDepthWrite: boolean;
  originalTransparent: boolean;
  originalAlphaHash: boolean;
}>;

/**
 * Per-material fade state lives here rather than on the material, so attaching
 * twice is detectable and nothing extra is written onto three's objects.
 */
const fadeStates = new WeakMap<Material, FadeState>();
const blendModes = new WeakMap<Material, BlendMode>();

/**
 * Adds the fade to a standard material, once. Safe under StrictMode double
 * effects: a second call is a no-op and returns the uniforms already attached.
 * Returns null for materials without the standard shader chunks.
 *
 * three.js materials are configured by mutation; the writes go through one
 * explicit Object.assign so they are easy to find.
 */
export const attachLayerFade = (
  material: Material,
  uniforms: LayerUniforms,
): LayerUniforms | null => {
  const existing = fadeStates.get(material);
  if (existing) return existing.uniforms;
  if (!isStandard(material)) return null;
  fadeStates.set(material, {
    uniforms,
    originalSide: material.side,
    originalDepthWrite: material.depthWrite,
    originalTransparent: material.transparent,
    originalAlphaHash: material.alphaHash,
  });
  blendModes.set(material, "solid");
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  Object.assign(material, {
    onBeforeCompile: (
      shader: Parameters<Material["onBeforeCompile"]>[0],
      renderer: Parameters<Material["onBeforeCompile"]>[1],
    ) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      Object.assign(shader, {
        fragmentShader: patchLayerFragment(shader.fragmentShader),
      });
    },
    customProgramCacheKey: () => `${previousKey()}|${LAYER_FADE_CACHE_KEY}`,
    needsUpdate: true,
  });
  return uniforms;
};

/** The uniforms attached to a material, if any. */
export const layerFadeUniforms = (material: Material): LayerUniforms | null =>
  fadeStates.get(material)?.uniforms ?? null;

/**
 * solid: opaque, early-z, no discard. hash: alphaHash dither, stays in the
 * opaque queue with correct depth (nested atlas layers have no valid blend
 * order). blend: real transparency for the single enclosing scan surface.
 */
export type BlendMode = "solid" | "hash" | "blend";

export const blendModeFor = (mix: LayerMix, kind: "scan" | "atlas"): BlendMode =>
  mix.alpha >= 0.999 && mix.fade <= 0.001 ? "solid" : kind === "scan" ? "blend" : "hash";

/** Switches mode only on a change, so the program recompiles rarely. Returns true if changed. */
export const setBlendMode = (material: Material, mode: BlendMode): boolean => {
  const state = fadeStates.get(material);
  if (!state || blendModes.get(material) === mode) return false;
  blendModes.set(material, mode);
  // "solid" restores the material exactly as it arrived.
  Object.assign(material, {
    alphaHash: mode === "hash" || (mode === "solid" && state.originalAlphaHash),
    transparent: mode === "blend" || (mode === "solid" && state.originalTransparent),
    depthWrite: mode === "blend" ? false : state.originalDepthWrite,
    side: mode === "blend" ? FrontSide : state.originalSide,
    needsUpdate: true,
  });
  return true;
};

/** Writes a LayerMix into the uniforms (cheap; no recompile). */
export const applyMixToUniforms = (uniforms: LayerUniforms, mix: LayerMix): void => {
  Object.assign(uniforms.uLayerAlpha, { value: mix.alpha });
  Object.assign(uniforms.uLayerFade, { value: mix.fade });
};

/**
 * Highlight: a calm blue, not a warning colour. The base colour is tinted
 * toward it (the baked AO still shades it, so the shape stays readable) plus a
 * small glow; a glow alone clips to white on pale parts such as bone. Colour
 * and emissive are uniforms, so switching never recompiles the program, and
 * the fade's alpha still applies, so a highlighted part fades with its layer.
 */
export const HIGHLIGHT_COLOUR = "#3a8ee0";
/** How far the base colour moves toward HIGHLIGHT_COLOUR, 0..1. */
export const HIGHLIGHT_TINT = 0.6;
export const HIGHLIGHT_INTENSITY = 0.25;

type Look = Readonly<{ color: Color; emissive: Color; emissiveIntensity: number }>;

/** The look a material had before its first highlight, so clearing restores it exactly. */
const unlitLooks = new WeakMap<Material, Look>();

const HIGHLIGHT = new Color(HIGHLIGHT_COLOUR);

/** Remembers how a material looks now and returns how it looks lit. */
const lightUp = (material: MeshStandardMaterial): Look => {
  unlitLooks.set(material, {
    color: material.color.clone(),
    emissive: material.emissive.clone(),
    emissiveIntensity: material.emissiveIntensity,
  });
  return {
    color: material.color.clone().lerp(HIGHLIGHT, HIGHLIGHT_TINT),
    emissive: HIGHLIGHT,
    emissiveIntensity: HIGHLIGHT_INTENSITY,
  };
};

/**
 * Turns a material's highlight on or off. Returns true if anything changed.
 * Materials without the standard colour terms are left alone.
 *
 * Colours are copied into the material's own Color objects rather than
 * swapped for new ones, so anything holding a reference to them stays in step.
 */
export const setHighlighted = (material: Material, on: boolean): boolean => {
  if (!isStandard(material)) return false;
  const unlit = unlitLooks.get(material);
  if (on === (unlit !== undefined)) return false;
  // A live glow sits on top; lift it so the highlight sees the plain look.
  const glow = liftGlow(material);
  if (unlit) unlitLooks.delete(material);
  const next = unlit ?? lightUp(material);
  material.color.copy(next.color);
  material.emissive.copy(next.emissive);
  // three.js materials are configured by mutation; the one scalar goes through
  // an explicit Object.assign so it is easy to find.
  Object.assign(material, { emissiveIntensity: next.emissiveIntensity });
  if (glow) applyGlow(material, glow.colour, glow.amount);
  return true;
};

/**
 * Live vitals (G4): a glow added on top of whatever the material shows, the
 * highlight included. Emissive radiance is colour × intensity, so the glow is
 * folded into the colour at intensity 1 and the look underneath is kept to
 * restore exactly. A plain uniform change: nothing recompiles, and the frame
 * loop can set it every frame for a heartbeat.
 */
type Glow = Readonly<{
  /** The emissive look underneath, restored when the glow ends. */
  under: Readonly<{ emissive: Color; intensity: number }>;
  colour: Color;
  amount: number;
}>;

const glows = new WeakMap<Material, Glow>();
const scratch = new Color();

const showGlow = (material: MeshStandardMaterial, glow: Glow): void => {
  material.emissive
    .copy(glow.under.emissive)
    .multiplyScalar(glow.under.intensity)
    .add(scratch.copy(glow.colour).multiplyScalar(glow.amount));
  // The one scalar, through an explicit Object.assign (coding standards).
  Object.assign(material, { emissiveIntensity: 1 });
};

/** Puts the look underneath back and forgets the glow; returns what it was. */
const liftGlow = (material: MeshStandardMaterial): Glow | undefined => {
  const glow = glows.get(material);
  if (!glow) return undefined;
  glows.delete(material);
  material.emissive.copy(glow.under.emissive);
  Object.assign(material, { emissiveIntensity: glow.under.intensity });
  return glow;
};

const applyGlow = (
  material: MeshStandardMaterial,
  colour: Color,
  amount: number,
): void => {
  const under = glows.get(material)?.under ?? {
    emissive: material.emissive.clone(),
    intensity: material.emissiveIntensity,
  };
  const glow: Glow = { under, colour, amount };
  glows.set(material, glow);
  showGlow(material, glow);
};

/**
 * Sets the live glow of a material; 0 removes it and restores the look
 * underneath exactly. Returns false for materials without standard terms.
 */
export const setLiveGlow = (
  material: Material,
  amount: number,
  colour: Color,
): boolean => {
  if (!isStandard(material)) return false;
  if (amount <= 0) {
    liftGlow(material);
    return true;
  }
  applyGlow(material, colour, amount);
  return true;
};

/** Whether a material currently carries the highlight glow. */
export const isHighlighted = (material: Material): boolean => unlitLooks.has(material);

/** Muted, distinguishable colours; the baked AO in COLOR_0 multiplies them. */
export const LAYER_COLOURS: Readonly<
  Record<"muscle" | "skeleton" | OrganSystem, string>
> = {
  muscle: "#b5584e",
  skeleton: "#e8dfcc",
  musculoskeletal: "#e8dfcc",
  cardiovascular: "#c2453b",
  respiratory: "#e6a5ad",
  nervous: "#efd08c",
  digestive: "#d6a06a",
  metabolic: "#8f5b3e",
  endocrine: "#9b80cf",
  reproductive: "#d78db1",
  integumentary: "#d9b9a0",
  unassigned: "#9a9a9a",
};

export const createLayerMaterial = ({
  colour,
  vertexColors,
  uniforms,
}: Readonly<{
  colour: string;
  vertexColors: boolean;
  uniforms: LayerUniforms;
}>): MeshStandardMaterial => {
  const material = new MeshStandardMaterial({
    color: new Color(colour),
    roughness: 0.6,
    metalness: 0,
    vertexColors,
    side: FrontSide,
  });
  attachLayerFade(material, uniforms);
  return material;
};
