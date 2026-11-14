import {
  Color,
  FrontSide,
  LinearSRGBColorSpace,
  type Material,
  MeshStandardMaterial,
} from "three";

import { attachLayerFade, type LayerUniforms } from "./layer-material";

/**
 * The open-anatomy look for the CT skeleton, so its bones stand clear of the
 * pale body and backdrop and its modelled cartilage reads apart from bone.
 * Values copied from open-anatomy's studio lookdev (blender/studio.py: BONE,
 * BONE_SHADE, CARTILAGE, CARTILAGE_SHADE, EDGE and the two roughnesses), as
 * linear RGB, the same space Blender's Principled colours are in:
 *
 * - bone: warm ivory, going to a warm brown where its surface turns away;
 * - cartilage (nodes marked modelled): pale blue-white, going to grey-blue.
 *
 * The shade stands in for the studio's ambient occlusion and edge darkening:
 * a surface turning away from the camera goes toward its shade colour after
 * lighting, so the outline holds however bright the viewer's lights are and
 * the near rib separates from the ribs behind. The environment light is
 * turned down on these materials so the tones are not washed to white. As a
 * layer turns to glass the shade gives way to the layer's rim.
 */
export type CtTissue = "bone" | "cartilage";

type Rgb = readonly [number, number, number];

export const CT_LOOK: Readonly<
  Record<CtTissue, Readonly<{ colour: Rgb; shade: Rgb; roughness: number }>>
> = {
  bone: { colour: [0.87, 0.8, 0.66], shade: [0.38, 0.29, 0.2], roughness: 0.55 },
  cartilage: { colour: [0.76, 0.88, 0.98], shade: [0.42, 0.58, 0.76], roughness: 0.6 },
};

/** How far a surface turning fully away goes to its shade colour (studio EDGE). */
export const CT_EDGE = 0.7;

/** How much of the environment's light the CT bones take; the studio keeps its fill low. */
export const CT_ENV_INTENSITY = 0.6;
/**
 * The CT bones' light, scaled down so ivory and blue-white stay those colours
 * under the viewer's lights instead of clipping to white (solid only; a
 * glass layer keeps its own rim).
 */
export const CT_EXPOSURE = 0.5;

export const CT_SHADE_CACHE_KEY = "twin-ct-shade-v3";

const ANCHORS = {
  common: "#include <common>",
  light: "#include <opaque_fragment>",
} as const;

const DECLARATIONS = `
uniform vec3 uCtShade;
uniform float uCtEdge;
uniform float uCtExposure;`;

// The rim's edge term; uLayerFade comes from the layer fade patch, which
// every CT material also has (createCtMaterial).
const SHADE = `
#ifndef FLAT_SHADED
  float ctEdge = 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
  // Multiply toward shade / colour, so the edge darkens by the same share
  // however bright the lit surface is (the lights run above 1 before tone mapping).
  vec3 ctShadeRatio = uCtShade / max( diffuse, vec3( 1e-3 ) );
  float ctAmount = uCtEdge * ctEdge * ( 1.0 - uLayerFade );
  outgoingLight *= mix( vec3( 1.0 ), ctShadeRatio, ctAmount ) * mix( uCtExposure, 1.0, uLayerFade );
#endif`;

/** Pure string patch; throws `ct-shade-anchor-missing:<name>` if three moved a chunk. */
export const patchShadeFragment = (source: string): string => {
  for (const [name, anchor] of Object.entries(ANCHORS)) {
    if (source.split(anchor).length !== 2) {
      throw new Error(`ct-shade-anchor-missing:${name}`);
    }
  }
  return source
    .replace(ANCHORS.common, `${ANCHORS.common}${DECLARATIONS}`)
    .replace(ANCHORS.light, `${SHADE}\n${ANCHORS.light}`);
};

const linear = (rgb: Rgb): Color =>
  new Color().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);

/**
 * A CT bone or cartilage material on the skeleton layer's shared uniforms.
 * The shade patch is set first, so the layer fade wraps it.
 */
export const createCtMaterial = (
  tissue: CtTissue,
  uniforms: LayerUniforms,
): MeshStandardMaterial => {
  const look = CT_LOOK[tissue];
  const material = new MeshStandardMaterial({
    color: linear(look.colour),
    roughness: look.roughness,
    metalness: 0,
    envMapIntensity: CT_ENV_INTENSITY,
    side: FrontSide,
  });
  const shade = {
    uCtShade: { value: linear(look.shade) },
    uCtEdge: { value: CT_EDGE },
    uCtExposure: { value: CT_EXPOSURE },
  };
  Object.assign(material, {
    onBeforeCompile: (shader: Parameters<Material["onBeforeCompile"]>[0]) => {
      Object.assign(shader.uniforms, shade);
      Object.assign(shader, {
        fragmentShader: patchShadeFragment(shader.fragmentShader),
      });
    },
    customProgramCacheKey: () => `${CT_SHADE_CACHE_KEY}|${tissue}`,
  });
  attachLayerFade(material, uniforms);
  return material;
};
