import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { ATLAS_IDS, ATLASES, type AtlasId } from "@/packages/anatomy/manifest";

import { isSelectable } from "../environment/pick-part";
import { prepareAtlas, type PreparedAtlas } from "./prepare-atlas";

/**
 * Every mesh an atlas keeps must be registered as a pickable part and light
 * something when clicked. Before, HRA meshes whose structure is the `-`
 * placeholder (calyces, vas deferens, urethra, hyoid) lit nothing, and one
 * misspelt liver segment showed as an unassigned organ.
 */

const triangle = (): BufferGeometry => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1.7, 0]), 3),
  );
  return geometry;
};

const node = (extras: Record<string, unknown>, name: string): Mesh => {
  const mesh = new Mesh(triangle(), new MeshStandardMaterial());
  mesh.name = name;
  mesh.userData = extras;
  return mesh;
};

const meshesIn = (root: Object3D): readonly Mesh[] => {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) found.push(object as Mesh);
  });
  return found;
};

/** The names of kept meshes that are not parts, and of parts that light nothing. */
const audit = (prepared: PreparedAtlas) => {
  const registered = new Set(prepared.parts.map((part) => part.mesh));
  return {
    notRegistered: meshesIn(prepared.root)
      .filter((mesh) => !registered.has(mesh))
      .map((mesh) => mesh.name),
    notSelectable: prepared.parts
      .filter((part) => !isSelectable(part, prepared.groups))
      .map((part) => part.name),
  };
};

describe("every atlas mesh is selectable", () => {
  test("HRA: placeholder structures get a group of their own name", () => {
    const root = new Group();
    root.add(
      node({ anatomical_structure_of: "#VHMLiver" }, "VH_M_liver"),
      node({ anatomical_structure_of: "-", ontologyid: "-" }, "VH_M_vas_deferens_L"),
      node({ anatomical_structure_of: "-" }, "VH_M_other_urethra"),
      node({ anatomical_structure_of: "-" }, "VH_M_hyoid"),
      node(
        { anatomical_structure_of: "-", ontologyid: "UBERON:0001227" },
        "VH_M_minor_calyx_R_a",
      ),
      node({ anatomical_structure_of: "#VHMSomethingNewV1.1" }, "VH_M_new"),
      node({ anatomical_structure_of: "-" }, "VH_M_left_superiomedial_segment"),
      node({ anatomical_structure_of: "#VHMSkinV1.2" }, "VH_M_skin"),
    );

    const prepared = prepareAtlas(root, ATLASES["hra-m"]);

    expect(prepared.parts.map((part) => [part.name, part.group, part.system])).toEqual([
      ["VH_M_liver", "liver", "metabolic"],
      ["VH_M_vas_deferens_L", "vasdeferens", "unassigned"],
      ["VH_M_other_urethra", "otherurethra", "unassigned"],
      ["VH_M_hyoid", "hyoid", "unassigned"],
      ["VH_M_minor_calyx_R_a", "minorcalyx", "metabolic"],
      ["VH_M_new", "somethingnew", "unassigned"],
    ]);
    expect(audit(prepared)).toEqual({ notRegistered: [], notSelectable: [] });
  });

  test("BodyParts3D: every system mesh, and an unknown one by its name", () => {
    const root = new Group();
    root.add(
      node({ system: "musculoskeletal", layer: "muscle" }, "musculoskeletalmuscle"),
      node({ system: "nervous", layer: "organ" }, "nervousorgan"),
      node({ layer: "organ" }, "mystery"),
      node({ system: "integumentary", layer: "organ" }, "integumentaryorgan"),
    );

    const prepared = prepareAtlas(root, ATLASES.bodyparts3d);

    expect(prepared.parts.map((part) => part.name)).toEqual([
      "musculoskeletalmuscle",
      "nervousorgan",
      "mystery",
    ]);
    expect(audit(prepared)).toEqual({ notRegistered: [], notSelectable: [] });
  });
});

/** The pinned atlases, when `bun run anatomy:fetch` has installed them here. */
const ATLAS_DIR = join(import.meta.dir, "../../../data/anatomy");

const loadPinned = async (id: AtlasId): Promise<Object3D> => {
  const bytes = readFileSync(join(ATLAS_DIR, ATLASES[id].fileName));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return gltf.scene;
};

describe("every mesh of the installed atlases is selectable", () => {
  for (const id of ATLAS_IDS) {
    const installed = existsSync(join(ATLAS_DIR, ATLASES[id].fileName));
    test.skipIf(!installed)(
      id,
      async () => {
        const prepared = prepareAtlas(await loadPinned(id), ATLASES[id]);
        expect(audit(prepared)).toEqual({ notRegistered: [], notSelectable: [] });
      },
      60_000,
    );
  }
});
