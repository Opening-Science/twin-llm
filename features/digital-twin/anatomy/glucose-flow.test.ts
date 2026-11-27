import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { GLUCOSE_EFFECT } from "@/packages/anatomy/effects";

import { createGlucoseFlow, glucoseUnavailable } from "./glucose-flow";

/** The pinned effect, when `bun run anatomy:fetch` has installed it here. */
const EFFECT_FILE = join(
  import.meta.dir,
  "../../../data/anatomy",
  GLUCOSE_EFFECT.fileName,
);

const pool = () => {
  const root = new Group();
  for (let rank = 0; rank < 180; rank++) {
    const node = new Group();
    node.name = `GlucoseParticle_${String(rank).padStart(3, "0")}`;
    node.userData = {
      glucoseDensityRank: rank,
      glucoseDensityCount: 180,
      glucoseDensityVersion: 1,
    };
    root.add(node);
  }
  const clip = new AnimationClip("GlucoseFlow", 12, [
    new NumberKeyframeTrack("GlucoseParticle_000.position[x]", [0, 12], [0, 12]),
  ]);
  return { root, clips: [clip] };
};

describe("glucose flow", () => {
  test("replay markers gain size and contrast without changing shared routes or authored mode", () => {
    for (const presentation of ["authored", "replay-markers"] as const) {
      const { root, clips } = pool();
      const geometry = new BoxGeometry();
      const material = new MeshBasicMaterial();
      const [a, b] = [new Mesh(geometry, material), new Mesh(geometry, material)];
      const names = root.children.slice(0, 2).map(({ name }) => name);
      root.remove(...root.children.slice(0, 2));
      a.name = names[0]!;
      b.name = names[1]!;
      root.add(a, b);
      const flow = createGlucoseFlow(root, clips, presentation);
      const overlay = presentation === "replay-markers";
      geometry.computeBoundingBox();
      expect(geometry.boundingBox?.max.x).toBe(overlay ? 2.25 : 0.5);
      expect(material.depthTest).toBe(!overlay);
      expect(material.transparent).toBe(overlay);
      expect(flow.setDensity(0.5)).toBe(90);
      flow.update(1);
      expect(a.position.x).toBe(1);
      flow.dispose();
      geometry.dispose();
      material.dispose();
    }
  });

  test("density changes visibility, never playback phase or the fixed 1x rate", () => {
    const { root, clips } = pool();
    const flow = createGlucoseFlow(root, clips);
    flow.update(1);
    for (const [density, expected] of [
      [0, 0],
      [0.25, 45],
      [0.5, 90],
      [1, 180],
    ] as const) {
      expect(flow.setDensity(density)).toBe(expected);
      expect(root.children.filter((node) => node.visible).length).toBe(expected);
      expect(root.children[0].position.x).toBe(1);
    }
    flow.setDensity(0);
    flow.update(0.5);
    expect(root.children[0].visible).toBe(false);
    expect(root.children[0].position.x).toBe(1.5);
    flow.setDensity(0.5);
    flow.update(11);
    expect(root.children[0].position.x).toBeCloseTo(0.5, 6);
    expect(root.children[90].visible).toBe(false);
    flow.dispose();
  });

  test("rejects invalid density without changing the previous visibility", () => {
    const { root, clips } = pool();
    const flow = createGlucoseFlow(root, clips);
    flow.setDensity(0.25);
    for (const density of [-1, 1.01, NaN, Infinity, -Infinity]) {
      expect(() => flow.setDensity(density)).toThrow(RangeError);
      expect(root.children.map((node) => node.visible)).toEqual(
        root.children.map((_, rank) => rank < 45),
      );
    }
    flow.dispose();
  });

  test("supports metadata-only nodes and the stable-name fallback", () => {
    const metadata = pool();
    metadata.root.children.forEach((node, rank) => {
      Object.assign(node, { name: `metadata_${rank}` });
    });
    const byMetadata = createGlucoseFlow(metadata.root, [
      new AnimationClip("GlucoseFlow", 12, []),
    ]);
    expect(byMetadata.setDensity(0.5)).toBe(90);
    byMetadata.dispose();

    const named = pool();
    named.root.children.forEach((node) => Object.assign(node, { userData: {} }));
    const byName = createGlucoseFlow(named.root, named.clips);
    expect(byName.setDensity(0.25)).toBe(45);
    byName.dispose();
  });

  test("rejects incomplete, duplicate, conflicting and unsupported pools and missing animation", () => {
    const incomplete = pool();
    incomplete.root.remove(incomplete.root.children[179]);
    expect(() => createGlucoseFlow(incomplete.root, incomplete.clips)).toThrow(
      "incomplete",
    );
    const duplicate = pool();
    Object.assign(duplicate.root.children[1], {
      name: "GlucoseParticle_000",
      userData: { glucoseDensityRank: 0 },
    });
    expect(() => createGlucoseFlow(duplicate.root, duplicate.clips)).toThrow("duplicate");
    for (const invalid of [
      { glucoseDensityRank: 1 },
      { glucoseDensityCount: 179 },
      { glucoseDensityVersion: 2 },
    ]) {
      const { root, clips } = pool();
      Object.assign(root.children[0].userData, invalid);
      expect(() => createGlucoseFlow(root, clips)).toThrow("metadata");
    }
    const { root } = pool();
    expect(() => createGlucoseFlow(root, [])).toThrow("animation is missing");
  });

  test.skipIf(!existsSync(EFFECT_FILE))(
    "the fetched GLB matches its pin and supports all 101 density settings",
    async () => {
      const bytes = await readFile(EFFECT_FILE);
      expect(bytes.byteLength).toBe(GLUCOSE_EFFECT.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        GLUCOSE_EFFECT.sha256,
      );
      const buffer = new Uint8Array(bytes).buffer;
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      expect(gltf.animations.map((clip) => [clip.name, clip.duration])).toEqual([
        ["GlucoseFlow", 12],
      ]);
      const meshes: Mesh[] = [];
      gltf.scene.traverse((node) => {
        if (node instanceof Mesh && node.userData.glucoseDensityRank !== undefined) {
          meshes.push(node);
        }
      });
      expect(meshes.length).toBe(180);
      expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1);
      const geometry = meshes[0].geometry;
      const positions = geometry.getAttribute("position");
      const original = Array.from({ length: positions.count }, (_, i) => [
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i),
      ]);
      geometry.computeBoundingBox();
      const originalBounds = geometry.boundingBox!.clone();
      const flow = createGlucoseFlow(gltf.scene, gltf.animations);
      expect(flow.maxParticles).toBe(180);
      expect(meshes.every((mesh) => mesh.geometry === geometry)).toBe(true);
      // Particles keep the size the vessel-wall check was run at.
      const expectUnscaled = () => {
        for (let i = 0; i < original.length; i++) {
          expect(positions.getX(i)).toBe(original[i][0]);
          expect(positions.getY(i)).toBe(original[i][1]);
          expect(positions.getZ(i)).toBe(original[i][2]);
        }
      };
      expectUnscaled();
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.equals(originalBounds)).toBe(true);
      const particles: Object3D[] = [];
      gltf.scene.traverse((node) => {
        if (node.userData.glucoseDensityRank !== undefined) particles.push(node);
      });
      for (let percent = 0; percent <= 100; percent++) {
        const count = Math.round(percent * 1.8);
        expect(flow.setDensity(percent / 100)).toBe(count);
        flow.update(0.01);
        expect(particles.filter((node) => node.visible).length).toBe(count);
      }
      flow.dispose();
      const second = createGlucoseFlow(gltf.scene, gltf.animations);
      expectUnscaled();
      second.dispose();
    },
    60_000,
  );
});

describe("glucose atlas integration policy", () => {
  test("only the original standing BodyParts3D is supported", () => {
    expect(glucoseUnavailable("bodyparts3d", false, false)).toBeNull();
    expect(glucoseUnavailable("hra-f", false, false)).toBe(
      "Particles are available only with BodyParts3D.",
    );
    expect(glucoseUnavailable("hra-m", false, false)).toBe(
      "Particles are available only with BodyParts3D.",
    );
    expect(glucoseUnavailable("bodyparts3d", true, false)).toBe(
      "Particles are not available with a fitted atlas.",
    );
    expect(glucoseUnavailable("bodyparts3d", false, true)).toBe(
      "Particles are available only in the standing pose.",
    );
  });
});
