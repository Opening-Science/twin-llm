import { Box3, type Material, type Mesh, type Object3D, Vector3 } from "three";

import { classifyAtlasNode } from "@/packages/anatomy/atlas-nodes";
import { groupKey, normaliseGroup } from "@/packages/anatomy/hra-groups";
import { groupLabel, type AtlasGroup, type PartView } from "@/packages/anatomy/highlight";
import { ATLAS_LAYER_IDS, type AtlasLayerId } from "@/packages/anatomy/layers";
import { type AtlasEntry } from "@/packages/anatomy/manifest";
import { isSystemId, type OrganSystem, type SystemId } from "@/packages/anatomy/systems";

import { disposeObject3D } from "../dispose-object";
import {
  createLayerMaterial,
  createLayerUniforms,
  LAYER_COLOURS,
  type LayerUniforms,
} from "./layer-material";

export type AtlasPart = Readonly<{
  mesh: Mesh;
  layer: AtlasLayerId;
  system: OrganSystem;
  /** HRA organ-group key after `normaliseGroup` (`liver`); null on BodyParts3D. */
  group: string | null;
  /** The tagged node's name (the mesh's own, or its group's). */
  name: string;
  /** The node's `ontologyid` extra (`FMA:14487`, `UBERON:…`), when it has one. */
  ontologyId: string | null;
}>;

export type PreparedAtlas = Readonly<{
  root: Object3D;
  /**
   * Atlas box in its own frame. Height (y) is the whole scene's, skin included,
   * since the fit scales by it; x and z come from the kept parts only, so a
   * dropped part (HRA's placenta sits 12 cm in front of the skin) cannot pull
   * the bounding-box anchor forward.
   */
  box: Box3;
  parts: readonly AtlasPart[];
  presentLayers: ReadonlySet<AtlasLayerId>;
  /** Organ systems that actually have meshes, in first-seen order. */
  systems: readonly OrganSystem[];
  /** Systems with a mesh in any layer (skeleton and muscle included), first-seen order. */
  partSystems: readonly SystemId[];
  /** HRA organ groups that kept meshes, in first-seen order; empty on BodyParts3D. */
  groups: readonly AtlasGroup[];
  /** Each distinct layer, system and group once: what the UI needs without the meshes. */
  views: readonly PartView[];
  triangles: number;
  uniforms: Readonly<Record<AtlasLayerId, LayerUniforms>>;
}>;

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

/** GLTFLoader puts node extras on the node's object, which may be the mesh or its group. */
const taggedAncestor = (mesh: Mesh, root: Object3D): Object3D => {
  let node: Object3D | null = mesh;
  while (node && node !== root) {
    if (Object.keys(node.userData).length > 0) return node;
    node = node.parent;
  }
  return mesh;
};

const disposeMaterials = (material: Material | Material[]): void => {
  for (const item of Array.isArray(material) ? material : [material]) item.dispose();
};

/**
 * Classifies every atlas mesh into a UI layer, drops the atlas skin and
 * donor-specific parts (disposed, not just hidden), computes the normals the
 * atlases ship without, and swaps in layer materials whose uniforms are shared
 * per layer so one write per frame drives the whole layer.
 */
export const prepareAtlas = (root: Object3D, entry: AtlasEntry): PreparedAtlas => {
  root.updateMatrixWorld(true);
  const whole = new Box3().setFromObject(root);
  const uniforms: Record<AtlasLayerId, LayerUniforms> = {
    muscle: createLayerUniforms(0),
    skeleton: createLayerUniforms(0),
    organs: createLayerUniforms(0),
  };

  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object)) meshes.push(object);
  });

  const parts: AtlasPart[] = [];
  const systems: OrganSystem[] = [];
  const groups: AtlasGroup[] = [];
  const partSystems: SystemId[] = [];
  let triangles = 0;
  for (const mesh of meshes) {
    const tagged = taggedAncestor(mesh, root);
    const placement = classifyAtlasNode(entry.scheme, tagged.userData, tagged.name);
    if (placement.kind !== "layer") {
      mesh.removeFromParent();
      disposeObject3D(mesh);
      continue;
    }
    const geometry = mesh.geometry;
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const previous = mesh.material;
    mesh.material = createLayerMaterial({
      colour:
        LAYER_COLOURS[placement.layer === "organs" ? placement.system : placement.layer],
      vertexColors: geometry.getAttribute("color") !== undefined,
      uniforms: uniforms[placement.layer],
    });
    disposeMaterials(previous);
    triangles += (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
    if (placement.layer === "organs" && !systems.includes(placement.system)) {
      systems.push(placement.system);
    }
    if (isSystemId(placement.system) && !partSystems.includes(placement.system)) {
      partSystems.push(placement.system);
    }
    const raw = entry.scheme === "hra" ? groupKey(tagged.userData, tagged.name) : null;
    const group = raw === null ? null : normaliseGroup(raw);
    if (raw !== null && group !== null && !groups.some((known) => known.key === group)) {
      groups.push({ key: group, label: groupLabel(raw) });
    }
    const ontologyId = tagged.userData.ontologyid;
    parts.push({
      mesh,
      layer: placement.layer,
      system: placement.system,
      group,
      name: tagged.name,
      ontologyId:
        typeof ontologyId === "string" && ontologyId !== "-" ? ontologyId : null,
    });
  }

  const kept = new Box3();
  for (const part of parts) kept.expandByObject(part.mesh);
  const box = kept.isEmpty()
    ? whole
    : new Box3(
        new Vector3(kept.min.x, whole.min.y, kept.min.z),
        new Vector3(kept.max.x, whole.max.y, kept.max.z),
      );

  const views = [
    ...new Map(
      parts.map((part) => [
        `${part.layer}|${part.system}|${part.group}`,
        { layer: part.layer, system: part.system, group: part.group },
      ]),
    ).values(),
  ];
  const presentLayers = new Set(
    ATLAS_LAYER_IDS.filter((layer) => parts.some((part) => part.layer === layer)),
  );
  return {
    root,
    box,
    parts,
    presentLayers,
    systems,
    partSystems,
    groups,
    views,
    triangles,
    uniforms,
  };
};
