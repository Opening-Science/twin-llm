export const GLUCOSE_EFFECT = {
  id: "glucose-particles",
  fileName: "glucose-particles/glucose-particles.glb",
  bytes: 1_749_892,
  sha256: "000834e73f4b008eb81a753a50d924ce52a8564b1cdec10bdb3911f90429d169",
  clip: "GlucoseFlow",
  maxParticles: 180,
} as const;

export type AnatomyEffectId = typeof GLUCOSE_EFFECT.id;

export const isAnatomyEffectId = (value: unknown): value is AnatomyEffectId =>
  value === GLUCOSE_EFFECT.id;

export const anatomyEffectVersion = (): string => GLUCOSE_EFFECT.sha256.slice(0, 16);

export const glucoseEffectApiUrl = (): string =>
  `/api/anatomy/effects/${GLUCOSE_EFFECT.id}?v=${anatomyEffectVersion()}`;
