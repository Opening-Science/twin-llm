import { RIGGED_RELEASE_HOSTS } from "./rigged-bodies";

/**
 * Anatomy effects: files drawn on top of an atlas, with no anatomy of their
 * own. `bun run anatomy:fetch` downloads them from the `anatomy-effects-v1`
 * release of this repository and installs a file only when its bytes match the
 * pin below. Like the atlases they are never committed.
 */
export type EffectId = "glucose-particles";

export type EffectEntry = Readonly<{
  id: EffectId;
  /** Shown by the fetch script. */
  name: string;
  /** The release asset; GitHub answers with a redirect to its asset host. */
  url: string;
  /** Relative to the anatomy data folder. */
  fileName: string;
  bytes: number;
  sha256: string;
  attribution: string;
}>;

/** The GitHub release that carries the pinned effects as assets. */
export const EFFECTS_RELEASE_TAG = "anatomy-effects-v1";

/** Release downloads redirect to the same GitHub hosts as the rigged bodies. */
export const EFFECTS_RELEASE_HOSTS: readonly string[] = RIGGED_RELEASE_HOSTS;

const EFFECTS_RELEASE_BASE = `https://github.com/Opening-Science/twin-llm/releases/download/${EFFECTS_RELEASE_TAG}`;

export const EFFECT_IDS: readonly EffectId[] = ["glucose-particles"];

export const isEffectId = (id: string): id is EffectId =>
  (EFFECT_IDS as readonly string[]).includes(id);

export const EFFECTS: Readonly<Record<EffectId, EffectEntry>> = Object.freeze({
  "glucose-particles": {
    id: "glucose-particles",
    name: "Glucose particles (illustrative)",
    url: `${EFFECTS_RELEASE_BASE}/glucose-particles.glb`,
    fileName: "glucose-particles/glucose-particles.glb",
    bytes: 1_749_892,
    sha256: "000834e73f4b008eb81a753a50d924ce52a8564b1cdec10bdb3911f90429d169",
    attribution:
      "Glucose particles: illustrative paths baked along the BodyParts3D vessels by the Open Science Foundation; BodyParts3D, © The Database Center for Life Science, CC BY 4.0. Not measured glucose or blood flow.",
  },
});

export const GLUCOSE_EFFECT = {
  ...EFFECTS["glucose-particles"],
  id: "glucose-particles",
  clip: "GlucoseFlow",
  maxParticles: 180,
} as const;

export type AnatomyEffectId = typeof GLUCOSE_EFFECT.id;

export const isAnatomyEffectId = (value: unknown): value is AnatomyEffectId =>
  value === GLUCOSE_EFFECT.id;

export const anatomyEffectVersion = (): string => GLUCOSE_EFFECT.sha256.slice(0, 16);

export const glucoseEffectApiUrl = (): string =>
  `/api/anatomy/effects/${GLUCOSE_EFFECT.id}?v=${anatomyEffectVersion()}`;
