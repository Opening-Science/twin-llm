import { describe, expect, test } from "bun:test";
import { Box3, BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";

import { fitAtlasToScan } from "@/packages/anatomy/fit";

import { readScanFrame } from "./anatomy/scan-frame";
import { DEMO_BODY_NODE, prepareDemoBody } from "./demo-body";
import { SCAN_ROUGHNESS } from "./scan-materials";

/**
 * A synthetic stand-in with the measured ANNY male frame: +Y up, faces +Z,
 * 1.914 m tall, feet at y=0, A-pose width 0.755 m, z from -0.120 to 0.213.
 * Like the real file it has no normals and GLTFLoader's metallic default.
 */
const syntheticAnny = (): Readonly<{ root: Object3D; mesh: Mesh }> => {
  const geometry = new BoxGeometry(0.755, 1.914, 0.333).toNonIndexed();
  geometry.deleteAttribute("normal");
  geometry.translate(-0.0035, 0.957, 0.0465);
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ metalness: 1, roughness: 1 }),
  );
  const root = new Object3D();
  root.add(mesh);
  return { root, mesh };
};

describe("prepareDemoBody", () => {
  test("computes normals and makes the default material matte", () => {
    const { root, mesh } = syntheticAnny();
    const wrapped = prepareDemoBody(root);
    expect(wrapped.name).toBe(DEMO_BODY_NODE);
    expect(mesh.geometry.getAttribute("normal").count).toBe(36);
    const material = mesh.material as MeshStandardMaterial;
    expect(material.metalness).toBe(0);
    expect(material.roughness).toBe(SCAN_ROUGHNESS);
  });

  test("lands in the scan frame: Z up, floor at 0, faces -Y, no hip joints", () => {
    const wrapped = prepareDemoBody(syntheticAnny().root);
    const frame = readScanFrame(wrapped);
    expect(frame.floorZ).toBeCloseTo(0, 6);
    expect(frame.height).toBeCloseTo(1.914, 6);
    expect(frame.hipMidpoint).toBeNull();
    // atlas-frame front (z=+0.213) maps to scan-frame y=-0.213
    expect(frame.box.min.y).toBeCloseTo(-0.213, 6);
    expect(frame.box.max.y).toBeCloseTo(0.12, 6);
    expect(frame.box.min.x).toBeCloseTo(-0.381, 6);
  });

  test("an atlas fits it by the bounding box: scaled to its height, feet on its floor", () => {
    const frame = readScanFrame(prepareDemoBody(syntheticAnny().root));
    // a synthetic 1.70 m atlas like BodyParts3D: feet at y=0, z from -0.05 to 0.25
    const atlasBox = new Box3(new Vector3(-0.33, 0, -0.05), new Vector3(0.33, 1.7, 0.25));
    const fit = fitAtlasToScan(
      { box: atlasBox, hipAnchor: { x: 0, z: 0.0715 }, mirrorX: false },
      frame,
    );
    expect(fit.ok).toBe(true);
    expect(fit.anchor).toBe("bbox");
    expect(fit.scale).toBeCloseTo(1.914 / 1.7, 6);
    expect(new Vector3(0, 0, 0.1).applyMatrix4(fit.matrix).z).toBeCloseTo(0, 6);
    expect(new Vector3(0, 1.7, 0.1).applyMatrix4(fit.matrix).z).toBeCloseTo(1.914, 6);
    // the atlas bbox centre lands on the demo body's bbox centre
    const centre = new Vector3(0, 0.85, 0.1).applyMatrix4(fit.matrix);
    expect(centre.x).toBeCloseTo(-0.0035, 6);
    expect(centre.y).toBeCloseTo(-0.0465, 6);
  });
});
