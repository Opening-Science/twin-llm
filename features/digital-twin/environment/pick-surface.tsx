"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { type Mesh, type Object3D, Raycaster, Vector2 } from "three";

import { type AtlasGroup } from "@/packages/anatomy/highlight";
import { type AtlasLayerId } from "@/packages/anatomy/layers";
import { type OrganSystem } from "@/packages/anatomy/systems";

import {
  choosePick,
  isTap,
  pickTarget,
  type PickablePart,
  type Picked,
  type PointerSample,
} from "./pick-part";
import { WALK_SURFACE_ATTR } from "./walk-controls";

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

/** Meshes of the body outline that draw: hidden helper nodes and their children are skipped. */
const shownMeshes = (root: Object3D): readonly Mesh[] => {
  const found: Mesh[] = [];
  const walk = (object: Object3D) => {
    if (!object.visible) return;
    if (isMesh(object)) found.push(object);
    for (const child of object.children) walk(child);
  };
  walk(root);
  return found;
};

type MeshPart = PickablePart & Readonly<{ mesh: Mesh }>;

/**
 * Listens for taps on the canvas and reports what was picked. Its own pointer
 * listeners rather than R3F events: R3F raycasts every descendant, hidden
 * layers included, while this tests only meshes that draw, which on the HRA
 * female atlas is millions of triangles fewer. A drag (orbit, pan, two-finger
 * walk) never picks. On the focused 3D view, Enter or Space picks what is
 * in the middle of the canvas (the orbit target), so walking aims a keyboard
 * pick. Renders nothing.
 */
export const PickSurface = ({
  enabled,
  scanRoot,
  parts,
  groups,
  getDepth,
  layers,
  hiddenSystems,
  onPick,
}: Readonly<{
  enabled: boolean;
  scanRoot: Object3D | null;
  parts: readonly MeshPart[];
  groups: readonly AtlasGroup[];
  /** The eased depth the frame loop draws with, so a pick matches what shows. */
  getDepth: () => number;
  layers: Readonly<Record<AtlasLayerId, boolean>>;
  hiddenSystems: readonly OrganSystem[];
  /** null: the tap hit nothing that draws. */
  onPick: (picked: Picked | null) => void;
}>) => {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const byMesh = useMemo(() => new Map(parts.map((part) => [part.mesh, part])), [parts]);
  // The listeners read the latest values without being re-attached.
  const live = useRef({
    scanRoot,
    parts,
    byMesh,
    groups,
    getDepth,
    layers,
    hiddenSystems,
    onPick,
  });
  useEffect(() => {
    live.current = {
      scanRoot,
      parts,
      byMesh,
      groups,
      getDepth,
      layers,
      hiddenSystems,
      onPick,
    };
  });

  useEffect(() => {
    if (!enabled) return;
    const element = gl.domElement;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const down = new Map<number, PointerSample>();
    let multiTouch = false;

    /** Picks along the ray through a canvas point in normalised device coordinates. */
    const pick = (x: number, y: number) => {
      const now = live.current;
      pointer.set(x, y);
      raycaster.setFromCamera(pointer, camera);
      const meshes = [
        ...(now.scanRoot ? shownMeshes(now.scanRoot) : []),
        ...now.parts.filter((part) => part.mesh.visible).map((part) => part.mesh),
      ];
      const hits = raycaster.intersectObjects(meshes, false);
      const mapped = hits.map((hit) => ({
        part: now.byMesh.get(hit.object as Mesh) ?? null,
        point: hit.point,
      }));
      const index = choosePick(mapped, now.getDepth(), now.layers, now.hiddenSystems);
      const chosen = index === null ? null : mapped[index]!;
      now.onPick(
        chosen
          ? {
              target: pickTarget(chosen.part, now.groups),
              point: [chosen.point.x, chosen.point.y, chosen.point.z],
            }
          : null,
      );
    };

    const onDown = (event: PointerEvent) => {
      if (down.size === 0) multiTouch = false;
      down.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        t: performance.now(),
      });
      if (down.size > 1) multiTouch = true;
    };
    const onUp = (event: PointerEvent) => {
      const start = down.get(event.pointerId);
      down.delete(event.pointerId);
      if (!start || multiTouch || event.button !== 0) return;
      const end = { x: event.clientX, y: event.clientY, t: performance.now() };
      if (!isTap(start, end)) return;
      const rect = element.getBoundingClientRect();
      pick(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const surface = element.closest<HTMLElement>(`[${WALK_SURFACE_ATTR}]`);
    const onKey = (event: KeyboardEvent) => {
      if (event.target !== surface || (event.key !== "Enter" && event.key !== " "))
        return;
      event.preventDefault();
      pick(0, 0);
    };
    const onCancel = (event: PointerEvent) => {
      down.delete(event.pointerId);
      multiTouch = true;
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onCancel);
    surface?.addEventListener("keydown", onKey);
    return () => {
      surface?.removeEventListener("keydown", onKey);
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onCancel);
    };
  }, [enabled, gl, camera]);

  return null;
};
