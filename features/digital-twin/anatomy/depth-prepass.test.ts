import { describe, expect, test } from "bun:test";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
} from "three";

import {
  attachDepthPrepass,
  createDepthPrepassMaterial,
  depthPrepassOf,
  isDepthPrepass,
  RENDER_ORDER,
  SCAN_RENDER_ORDER,
  setLayerPasses,
  setScanRenderOrder,
} from "./depth-prepass";

const part = (): Mesh => new Mesh(new BoxGeometry(), new MeshStandardMaterial());

describe("depth pre-pass", () => {
  test("writes depth only and draws in the transparent queue", () => {
    const material = createDepthPrepassMaterial();
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.transparent).toBe(true);
  });

  test("is a hidden child sharing the mesh's geometry, attached once", () => {
    const mesh = part();
    const material = createDepthPrepassMaterial();
    const prepass = attachDepthPrepass(mesh, material);
    expect(attachDepthPrepass(mesh, material)).toBe(prepass);
    expect(depthPrepassOf(mesh)).toBe(prepass);
    expect(mesh.children).toEqual([prepass]);
    expect(prepass.geometry).toBe(mesh.geometry);
    expect(prepass.material).toBe(material);
    expect(prepass.visible).toBe(false);
    expect(isDepthPrepass(prepass)).toBe(true);
    expect(isDepthPrepass(mesh)).toBe(false);
  });

  test("never takes a pick", () => {
    const mesh = part();
    const prepass = attachDepthPrepass(mesh, createDepthPrepassMaterial());
    Object.assign(prepass, { visible: true });
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    mesh.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0, 0), camera);
    const hits = raycaster.intersectObject(mesh, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.object === mesh)).toBe(true);
  });

  test("shows only while its layer is glass; pre-pass right before its colour", () => {
    const mesh = part();
    const prepass = attachDepthPrepass(mesh, createDepthPrepassMaterial());
    setLayerPasses(mesh, "skeleton", "fade");
    expect(prepass.visible).toBe(true);
    expect(prepass.renderOrder).toBe(RENDER_ORDER.skeleton.prepass);
    expect(mesh.renderOrder).toBe(RENDER_ORDER.skeleton.colour);
    expect(prepass.renderOrder).toBeLessThan(mesh.renderOrder);
    setLayerPasses(mesh, "skeleton", "rim");
    expect(prepass.visible).toBe(true);
    for (const mode of ["solid", "blend"] as const) {
      setLayerPasses(mesh, "skeleton", mode);
      expect(prepass.visible).toBe(false);
    }
  });

  test("inner layers draw first and the scan's glass last", () => {
    const orders = [
      RENDER_ORDER.organs.prepass,
      RENDER_ORDER.organs.colour,
      RENDER_ORDER.skeleton.prepass,
      RENDER_ORDER.skeleton.colour,
      RENDER_ORDER.muscle.prepass,
      RENDER_ORDER.muscle.colour,
      SCAN_RENDER_ORDER,
    ];
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
  });

  test("sets the scan's meshes to an order and back", () => {
    const root = new Group();
    const a = part();
    const b = part();
    root.add(a);
    a.add(b);
    setScanRenderOrder(root, SCAN_RENDER_ORDER);
    expect([a.renderOrder, b.renderOrder]).toEqual([
      SCAN_RENDER_ORDER,
      SCAN_RENDER_ORDER,
    ]);
    setScanRenderOrder(root, 0);
    expect([a.renderOrder, b.renderOrder]).toEqual([0, 0]);
  });
});
