/**
 * The depth model behind the Body twin slider: one number from the scan surface
 * (0) to the organs (3), and how solid, glassy or hidden each layer is there.
 *
 * Each layer goes hidden → solid → glass → gone as depth passes it, so at most
 * three atlas layers draw at once, and the scan always keeps a glass outline:
 *
 *   depth  scan   muscle  skeleton             organs
 *   0      solid  –       –                    –
 *   1      glass  solid   solid (fills gaps)   –
 *   2      glass  glass   solid                –
 *   3      glass  –       glass                solid
 *
 * Pure numbers only; the renderer turns a LayerMix into shader uniforms.
 */
import { type OrganSystem } from "./systems";

export const ATLAS_LAYER_IDS = ["muscle", "skeleton", "organs"] as const;

export type AtlasLayerId = (typeof ATLAS_LAYER_IDS)[number];

export type LayerId = "scan" | AtlasLayerId;

export const LAYER_IDS: readonly LayerId[] = ["scan", ...ATLAS_LAYER_IDS];

export const DEPTH_MIN = 0;
export const DEPTH_MAX = 3;

/** The slider's snap points, one per layer, in depth order. */
export const DEPTH_STOPS: readonly Readonly<{ depth: number; layer: LayerId }>[] = [
  { depth: 0, layer: "scan" },
  { depth: 1, layer: "muscle" },
  { depth: 2, layer: "skeleton" },
  { depth: 3, layer: "organs" },
];

/** How far, in depth units, a released slider snaps to the nearest stop. */
export const SNAP_DISTANCE = 0.12;

/** Below this a layer is treated as not drawn at all. */
const VISIBLE_EPSILON = 0.002;

export type LayerMix = Readonly<{
  /** Overall opacity multiplier, 0..1. */
  alpha: number;
  /** 0 = solid surface, 1 = glass (only the rim stays opaque). */
  fade: number;
  visible: boolean;
}>;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const LAYER_INDEX: Readonly<Record<LayerId, number>> = {
  scan: 0,
  muscle: 1,
  skeleton: 2,
  organs: 3,
};

/** When a layer starts to exist: skeleton early (it fills muscle gaps), organs late. */
const presence = (layer: LayerId, depth: number): number => {
  if (layer === "skeleton") return smoothstep(0.5, 1, depth);
  if (layer === "organs") return smoothstep(2, 2.5, depth);
  return 1;
};

export const layerMix = (layer: LayerId, depth: number): LayerMix => {
  const d = clamp(depth, DEPTH_MIN, DEPTH_MAX);
  const i = LAYER_INDEX[layer];
  const fade = layer === "organs" ? 0 : smoothstep(i, i + 1, d);
  const ghost = layer === "scan" ? 1 : 1 - smoothstep(i + 1, i + 2, d);
  const alpha = presence(layer, d) * ghost;
  const visible = alpha > VISIBLE_EPSILON && (layer === "scan" || d > VISIBLE_EPSILON);
  return { alpha, fade, visible };
};

/** Toggles only ever hide; the slider alone decides solid versus glass. */
export const applyMask = (mix: LayerMix, shown: boolean): LayerMix =>
  shown ? mix : { ...mix, visible: false };

/** A part's own toggles: its layer's checkbox and, for organs, its system chip. */
export const partShown = (
  part: Readonly<{ layer: AtlasLayerId; system: OrganSystem }>,
  layers: Readonly<Record<AtlasLayerId, boolean>>,
  hiddenSystems: readonly OrganSystem[],
): boolean =>
  layers[part.layer] && (part.layer !== "organs" || !hiddenSystems.includes(part.system));

/**
 * Exponential approach to the target, frame-rate independent. Reduced motion
 * jumps straight there. Snaps once close so the render loop can go idle.
 */
export const dampDepth = (
  current: number,
  target: number,
  dtSeconds: number,
  reducedMotion: boolean,
): number => {
  if (reducedMotion) return target;
  // R3F's delta after an idle stretch is large; one frame should never jump far.
  const dt = clamp(dtSeconds, 0, 1 / 30);
  const next = target + (current - target) * Math.exp(-7 * dt);
  return Math.abs(next - target) < 1e-3 ? target : next;
};

/** On release: the nearest stop when within SNAP_DISTANCE, otherwise unchanged. */
export const snapDepth = (depth: number): number => {
  const nearest = DEPTH_STOPS.reduce((best, stop) =>
    Math.abs(stop.depth - depth) < Math.abs(best.depth - depth) ? stop : best,
  );
  return Math.abs(nearest.depth - depth) <= SNAP_DISTANCE + 1e-9 ? nearest.depth : depth;
};

/** Arrow keys and buttons: the next stop up or down from the current depth. */
export const stepStop = (depth: number, direction: 1 | -1): number => {
  const stops = DEPTH_STOPS.map((stop) => stop.depth);
  const next =
    direction === 1
      ? stops.find((stop) => stop > depth + 1e-6)
      : [...stops].reverse().find((stop) => stop < depth - 1e-6);
  return next ?? (direction === 1 ? DEPTH_MAX : DEPTH_MIN);
};

/** Where a depth sits: exactly on a stop, or between two neighbouring layers. */
export const depthPosition = (
  depth: number,
): Readonly<{ exact: LayerId } | { between: readonly [LayerId, LayerId] }> => {
  const d = clamp(depth, DEPTH_MIN, DEPTH_MAX);
  const onStop = DEPTH_STOPS.find((stop) => Math.abs(stop.depth - d) < 0.02);
  if (onStop) return { exact: onStop.layer };
  const lower = DEPTH_STOPS[Math.floor(d)] ?? DEPTH_STOPS[0];
  const upper = DEPTH_STOPS[Math.ceil(d)] ?? DEPTH_STOPS[DEPTH_STOPS.length - 1];
  return { between: [lower.layer, upper.layer] };
};
