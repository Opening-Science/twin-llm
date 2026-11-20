import { type Object3D } from "three";

type GlucoseDensityController = Readonly<{
  maxParticles: number;
  setDensity: (density: number) => number;
}>;

/** Optional Three.js adapter. The GLB metadata/name contract is renderer-independent. */
export function createGlucoseDensityController(root: Object3D): GlucoseDensityController {
  const particles: { node: Object3D; rank: number }[] = [];
  root.traverse((node) => {
    const match = /^GlucoseParticle_(\d{3})$/.exec(node.name);
    if (!match) return;
    const rank = Number(match[1]);
    if (
      node.userData.glucoseDensityRank !== undefined &&
      node.userData.glucoseDensityRank !== rank
    ) {
      throw new Error(`Conflicting glucose density rank: ${node.name}`);
    }
    particles.push({ node, rank });
  });
  if (!particles.length) throw new Error("No density-enabled glucose particles found.");
  particles.sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < particles.length; i++) {
    const { node, rank } = particles[i]!;
    if (
      rank !== i ||
      (node.userData.glucoseDensityCount !== undefined &&
        node.userData.glucoseDensityCount !== particles.length)
    ) {
      throw new Error("Glucose particle pool is incomplete or has duplicate ranks.");
    }
  }
  return {
    maxParticles: particles.length,
    setDensity(density) {
      if (!Number.isFinite(density) || density < 0 || density > 1) {
        throw new RangeError("Particle density must be a finite number between 0 and 1.");
      }
      const count = Math.round(density * particles.length);
      for (const { node, rank } of particles) node.visible = rank < count;
      return count;
    },
  };
}
