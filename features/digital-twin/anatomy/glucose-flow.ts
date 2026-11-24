import { AnimationMixer, LoopRepeat, type AnimationClip, type Object3D } from "three";

import { GLUCOSE_EFFECT } from "@/packages/anatomy/effects";
import { type AtlasId } from "@/packages/anatomy/manifest";

/** `missing`: the file is not fetched here, which is a setup step, not a failure. */
export type GlucoseStatus = "idle" | "loading" | "ready" | "missing" | "error";

export const glucoseUnavailable = (
  atlasId: AtlasId,
  fitted: boolean,
  moving: boolean,
): string | null => {
  if (atlasId !== "bodyparts3d") return "Particles are available only with BodyParts3D.";
  if (fitted) return "Particles are not available with a fitted atlas.";
  if (moving) return "Particles are available only in the standing pose.";
  return null;
};

/** Typed implementation of the handoff's metadata/name and visibility contract. */
export const createGlucoseFlow = (root: Object3D, clips: readonly AnimationClip[]) => {
  const particles: { node: Object3D; rank: number }[] = [];
  root.traverse((node) => {
    const match = /^GlucoseParticle_(\d{3})$/.exec(node.name);
    const metadata: unknown = node.userData.glucoseDensityRank;
    if (!match && metadata === undefined) return;
    const rank = metadata === undefined ? Number(match?.[1]) : metadata;
    if (
      typeof rank !== "number" ||
      !Number.isInteger(rank) ||
      (match && rank !== Number(match[1])) ||
      (node.userData.glucoseDensityCount !== undefined &&
        node.userData.glucoseDensityCount !== GLUCOSE_EFFECT.maxParticles) ||
      (node.userData.glucoseDensityVersion !== undefined &&
        node.userData.glucoseDensityVersion !== 1)
    ) {
      throw new Error(`Invalid glucose density metadata: ${node.name}`);
    }
    particles.push({ node, rank });
  });
  particles.sort((a, b) => a.rank - b.rank);
  if (
    particles.length !== GLUCOSE_EFFECT.maxParticles ||
    particles.some(({ rank }, index) => rank !== index)
  ) {
    throw new Error("Glucose particle pool is incomplete or has duplicate ranks.");
  }
  const clip = clips.find((candidate) => candidate.name === GLUCOSE_EFFECT.clip);
  if (!clip) throw new Error("GlucoseFlow animation is missing.");
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopRepeat, Infinity);
  action.setEffectiveTimeScale(1);
  action.play();
  mixer.update(0);

  return {
    root,
    maxParticles: particles.length,
    setDensity(density: number): number {
      if (!Number.isFinite(density) || density < 0 || density > 1) {
        throw new RangeError("Particle density must be a finite number between 0 and 1.");
      }
      const count = Math.round(density * particles.length);
      for (const { node, rank } of particles)
        Object.assign(node, { visible: rank < count });
      return count;
    },
    update(deltaSeconds: number): void {
      mixer.update(deltaSeconds);
    },
    dispose(): void {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
};
