import {
  AnimationMixer,
  LoopRepeat,
  Mesh,
  type AnimationClip,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

import { GLUCOSE_EFFECT } from "@/packages/anatomy/effects";
import { type AtlasId } from "@/packages/anatomy/manifest";

import { SCAN_RENDER_ORDER } from "./depth-prepass";

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
export const createGlucoseFlow = (
  root: Object3D,
  clips: readonly AnimationClip[],
  presentation: "authored" | "replay-markers" = "authored",
) => {
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
  if (presentation === "replay-markers") {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    for (const { node } of particles) {
      if (!(node instanceof Mesh)) continue;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        materials.add(material);
      }
      Object.assign(node, { renderOrder: SCAN_RENDER_ORDER + 1 });
    }
    // Keep authored paths and keyframes; draw legible markers over the atlas depth passes.
    for (const geometry of geometries) geometry.scale(4.5, 4.5, 4.5);
    for (const material of materials) {
      Object.assign(material, { depthTest: false, depthWrite: false, transparent: true });
    }
  }
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
