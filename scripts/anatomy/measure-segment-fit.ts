/**
 * Host CLI: measure the browser's segment fit on the pinned atlases and the
 * rigged demo bodies, as the viewer makes it at rest.
 *
 *   bun scripts/anatomy/measure-segment-fit.ts
 *
 * Reads `data/anatomy` (or ANATOMY_DATA_DIR) and prints the tables in
 * docs/anatomy.md, "Segment fit in the browser". Nothing is written. Per body
 * and atlas: how far the atlas's wrists, ankles, toe tips, fingertips and
 * crown land from the body's; the fitted skeleton's crown-to-heel height over
 * the body's; and the share of skeleton, organ, hand and foot vertices inside
 * the body's skin. "Before" is the fit as it was first made (bones blended
 * like soft tissue and scaled with the skin's girth), "after" the fit now
 * (bones rigid to one segment and scaled evenly).
 */
import { existsSync, readFileSync } from "node:fs";

import { type Mesh, type Object3D, type SkinnedMesh, Vector3, type Matrix4 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { prepareAtlas } from "../../features/digital-twin/anatomy/prepare-atlas";
import {
  readBody,
  type BodyReading,
} from "../../features/digital-twin/anatomy/read-body";
import { skinAtlas } from "../../features/digital-twin/anatomy/skinned-atlas";
import { bindRig } from "../../features/digital-twin/motion/rig-map";
import { atlasJoints } from "../../packages/anatomy/atlas-joints";
import { DEMO_BODY_IDS, type DemoBodyId } from "../../packages/anatomy/demo-bodies";
import { ATLAS_IDS, ATLASES, type AtlasId } from "../../packages/anatomy/manifest";
import {
  atlasFilePath,
  resolveAnatomyDir,
  riggedBodyFilePath,
} from "../../packages/anatomy/paths";
import {
  boneWeights,
  buildSegments,
  FIT_ACROSS_BAND,
  FIT_ALONG_BAND,
  fitMatrices,
  labelPoints,
  measureSkin,
  SEGMENT_IDS,
  SIDES,
  skinWeights,
  trunkFrame,
  type Joints,
  type SkinMeasure,
} from "../../packages/anatomy/segments";

export const anatomyDir = (): string =>
  resolveAnatomyDir(process.env.ANATOMY_DATA_DIR, process.cwd());

/** True when every file the measurement reads is there. */
export const filesPresent = (
  dir: string,
  atlases: readonly AtlasId[] = ATLAS_IDS,
): boolean =>
  atlases.every((id) => existsSync(atlasFilePath(dir, id))) &&
  DEMO_BODY_IDS.every((id) => existsSync(riggedBodyFilePath(dir, id)));

const load = async (path: string): Promise<Object3D> => {
  const bytes = readFileSync(path);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
};

// --- Inside the skin -------------------------------------------------------------

/** Cell size of the grid the skin's triangles are filed in, in metres. */
const CELL = 0.01;

type Skin = Readonly<{ position: Float32Array; triangles: Uint32Array }>;

/** The body's skin at rest, in the body's frame: every visible skinned mesh. */
const bodySkin = (root: Object3D): Skin => {
  const position: number[] = [];
  const triangles: number[] = [];
  const point = new Vector3();
  root.traverseVisible((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const first = position.length / 3;
    const count = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < count; i += 1) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      position.push(point.x, point.y, point.z);
    }
    const index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? count); i += 1) {
      triangles.push(first + (index ? index.getX(i) : i));
    }
  });
  return {
    position: Float32Array.from(position),
    triangles: Uint32Array.from(triangles),
  };
};

/**
 * Whether points lie inside the skin: along each of the three axes, the
 * line through the point crosses the skin on both sides. So a mouth or a
 * gap between the lips does not count as outside, as in the doc's earlier
 * table.
 */
const insideSkin = (skin: Skin): ((p: Vector3) => boolean) => {
  const { position: v, triangles } = skin;
  const grids = [0, 1, 2].map((axis) => {
    const [u, w] = [(axis + 1) % 3, (axis + 2) % 3] as const;
    const cells = new Map<string, number[]>();
    for (let t = 0; t < triangles.length; t += 3) {
      const corners = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
      const us = corners.map((c) => v[3 * c + u]!);
      const ws = corners.map((c) => v[3 * c + w]!);
      for (
        let i = Math.floor(Math.min(...us) / CELL);
        i <= Math.floor(Math.max(...us) / CELL);
        i += 1
      ) {
        for (
          let j = Math.floor(Math.min(...ws) / CELL);
          j <= Math.floor(Math.max(...ws) / CELL);
          j += 1
        ) {
          const key = `${i},${j}`;
          const list = cells.get(key) ?? [];
          list.push(t);
          cells.set(key, list);
        }
      }
    }
    return { u, w, cells };
  });
  return (p: Vector3): boolean =>
    grids.every(({ u, w, cells }, axis) => {
      const pu = p.getComponent(u);
      const pw = p.getComponent(w);
      const pa = p.getComponent(axis);
      let above = false;
      let below = false;
      for (const t of cells.get(`${Math.floor(pu / CELL)},${Math.floor(pw / CELL)}`) ??
        []) {
        const [a, b, c] = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
        const au = v[3 * a + u]!,
          aw = v[3 * a + w]!;
        const bu = v[3 * b + u]! - au,
          bw = v[3 * b + w]! - aw;
        const cu = v[3 * c + u]! - au,
          cw = v[3 * c + w]! - aw;
        const det = bu * cw - bw * cu;
        if (det === 0) continue;
        const s = ((pu - au) * cw - (pw - aw) * cu) / det;
        const r = (bu * (pw - aw) - bw * (pu - au)) / det;
        if (s < 0 || r < 0 || s + r > 1) continue;
        const at =
          v[3 * a + axis]! +
          s * (v[3 * b + axis]! - v[3 * a + axis]!) +
          r * (v[3 * c + axis]! - v[3 * a + axis]!);
        if (at >= pa) above = true;
        else below = true;
        if (above && below) return true;
      }
      return false;
    });
};

// --- One body and atlas ----------------------------------------------------------

/** Where the GPU puts each vertex: its weighted segments' maps. */
const skinned = (
  points: Float32Array,
  weights: Readonly<{ index: Uint8Array; weight: Uint8Array }>,
  maps: readonly Matrix4[],
): Vector3[] =>
  Array.from({ length: points.length / 3 }, (_, i) => {
    const rest = new Vector3().fromArray(points, 3 * i);
    return [0, 1].reduce((sum, slot) => {
      const share = weights.weight[4 * i + slot]! / 255;
      return share === 0
        ? sum
        : sum.addScaledVector(
            rest.clone().applyMatrix4(maps[weights.index[4 * i + slot]!]!),
            share,
          );
    }, new Vector3());
  });

const meshPoints = (mesh: Mesh): Float32Array => {
  const position = mesh.geometry.getAttribute("position");
  const out = new Float32Array(3 * position.count);
  const point = new Vector3();
  for (let i = 0; i < position.count; i += 1) {
    point
      .fromBufferAttribute(position, i)
      .applyMatrix4(mesh.matrixWorld)
      .toArray(out, 3 * i);
  }
  return out;
};

/** The atlas's skin as the segment fit measures it (`segmentsFromSkin`). */
const atlasSkin = (hull: Float32Array, joints: Joints): SkinMeasure => {
  const first = measureSkin(hull, labelPoints(hull, buildSegments(joints, null)), joints);
  const skin =
    first && measureSkin(hull, labelPoints(hull, buildSegments(joints, first)), joints);
  if (!skin) throw new Error("atlas skin not measured");
  return skin;
};

const crown = (joints: Joints, skin: SkinMeasure): Vector3 =>
  joints.neck.clone().addScaledVector(trunkFrame(joints).axis, skin.top);

export const END_NAMES = ["wrist", "ankle", "toe tip", "fingertip", "crown"] as const;
export type EndName = (typeof END_NAMES)[number];

type Share = Readonly<{ before: number; after: number }>;

export type PairMeasure = Readonly<{
  body: DemoBodyId;
  atlas: AtlasId;
  bodyHeight: number;
  /** Whether the viewer shows this fit; false when a segment is out of band. */
  ok: boolean;
  /** Held segments out of band, with their along / across / depth scales. */
  outOfBand: readonly string[];
  /** Centimetres per end, both sides (the crown once), before and after. */
  ends: Readonly<
    Record<EndName, Readonly<{ before: readonly number[]; after: readonly number[] }>>
  >;
  /** Crown to heel of the fitted skeleton over the body's height, and over the atlas's own. */
  skeletonHeight: Share;
  atlasSkeletonShare: number;
  inside: Readonly<{ skeleton: Share; organs: Share; hands: Share; feet: Share }>;
  /** Per segment, skeleton vertices outside the skin after, as a share of all skeleton vertices. */
  boneOutside: Readonly<Record<string, number>>;
}>;

const measurePair = (
  bodyId: DemoBodyId,
  body: BodyReading,
  skin: Skin,
  inside: (p: Vector3) => boolean,
  atlasId: AtlasId,
  scene: Object3D,
): PairMeasure => {
  const prepared = prepareAtlas(scene, ATLASES[atlasId]);
  const joints = atlasJoints(atlasId);
  const ownSkin = atlasSkin(prepared.hull, joints);
  const segments = buildSegments(joints, ownSkin);
  // Each part's points, read before skinning replaces the plain meshes.
  prepared.root.updateMatrixWorld(true);
  const plain = prepared.parts.map((part) => ({
    layer: part.layer,
    points: meshPoints(part.mesh),
    triangles: part.mesh.geometry.index?.array ?? null,
  }));
  const { fit } = skinAtlas(prepared, segments);
  const fitted = fitMatrices(
    segments,
    body.segments,
    (i) => fit.held.has(i),
    fit.boneCentres,
  );
  // The first fit: one blended map for every vertex, girth-scaled, and no bone map.
  const first = fitMatrices(segments, body.segments, (i) => fit.held.has(i));

  const outOfBand = SEGMENT_IDS.flatMap((id) => {
    const index = SEGMENT_IDS.indexOf(id);
    if (!fit.held.has(index)) return [];
    const a = segments[id];
    const b = body.segments[id];
    const scales = [
      b.length / a.length,
      b.halfWidth / a.halfWidth,
      b.halfDepth / a.halfDepth,
    ];
    const along = id === "head" ? (scales[1]! + scales[2]!) / 2 : scales[0]!;
    const inBand =
      along >= FIT_ALONG_BAND[0] &&
      along <= FIT_ALONG_BAND[1] &&
      (id.startsWith("hand") ||
        scales.slice(1).every((s) => s >= FIT_ACROSS_BAND[0] && s <= FIT_ACROSS_BAND[1]));
    return inBand ? [] : [`${id} ${scales.map((s) => s.toFixed(2)).join(" / ")}`];
  });

  const at = (id: (typeof SEGMENT_IDS)[number]): number => SEGMENT_IDS.indexOf(id);
  const ends = (maps: readonly Matrix4[]): Record<EndName, number[]> => {
    const off = (id: (typeof SEGMENT_IDS)[number], from: Vector3, to: Vector3): number =>
      100 * from.clone().applyMatrix4(maps[at(id)]!).distanceTo(to);
    return {
      wrist: SIDES.map((s) => off(`forearm${s}`, joints.wrist[s], body.joints.wrist[s])),
      ankle: SIDES.map((s) => off(`shin${s}`, joints.ankle[s], body.joints.ankle[s])),
      "toe tip": SIDES.map((s) => off(`foot${s}`, ownSkin.toe[s], body.skin.toe[s])),
      fingertip: SIDES.map((s) =>
        off(`hand${s}`, ownSkin.finger[s], body.skin.finger[s]),
      ),
      crown: [off("head", crown(joints, ownSkin), crown(body.joints, body.skin))],
    };
  };
  const before = ends(first.matrices);
  const after = ends(fitted.bones);

  // Every vertex where each fit puts it, with its layer and (after) rigid segment.
  const placed = plain.map((part) => {
    const soft = skinWeights(part.points, segments);
    const rigid = part.layer === "skeleton";
    const now = rigid ? boneWeights(part.points, segments, part.triangles) : soft;
    return {
      layer: part.layer,
      segment: now.index,
      before: skinned(part.points, soft, first.matrices),
      after: skinned(part.points, now, rigid ? fitted.bones : fitted.matrices),
    };
  });
  const share = (keep: (layer: string, segment: string) => boolean): Share => {
    const picked = placed.flatMap((part) =>
      part.before.flatMap((point, i) =>
        keep(part.layer, SEGMENT_IDS[part.segment[4 * i]!]!)
          ? [{ before: point, after: part.after[i]! }]
          : [],
      ),
    );
    const of = (pick: (entry: (typeof picked)[number]) => Vector3): number =>
      picked.length === 0
        ? Number.NaN
        : (100 * picked.filter((entry) => inside(pick(entry))).length) / picked.length;
    return { before: of((e) => e.before), after: of((e) => e.after) };
  };

  // Heights along the body's up, which is the trunk's.
  const up = trunkFrame(body.joints).axis;
  const extent = (points: readonly Vector3[]): number => {
    const heights = points.map((p) => p.dot(up));
    return (
      heights.reduce((a, b) => Math.max(a, b), -Infinity) -
      heights.reduce((a, b) => Math.min(a, b), Infinity)
    );
  };
  const bones = placed.filter((part) => part.layer === "skeleton");
  const bodyPoints = Array.from({ length: skin.position.length / 3 }, (_, i) =>
    new Vector3().fromArray(skin.position, 3 * i),
  );
  const bodyHeight = extent(bodyPoints);
  const atlasUp = trunkFrame(joints).axis;
  const own = (points: Float32Array): number[] =>
    Array.from({ length: points.length / 3 }, (_, i) =>
      new Vector3().fromArray(points, 3 * i).dot(atlasUp),
    );
  const ownBones = plain
    .filter((part) => part.layer === "skeleton")
    .flatMap((part) => own(part.points));
  const ownSkinHeights = own(prepared.hull);
  const span = (values: readonly number[]): number =>
    values.reduce((a, b) => Math.max(a, b), -Infinity) -
    values.reduce((a, b) => Math.min(a, b), Infinity);

  const boneCount = bones.reduce((sum, part) => sum + part.after.length, 0);
  const boneOutside: Record<string, number> = {};
  for (const part of bones) {
    part.after.forEach((point, i) => {
      if (inside(point)) return;
      const id = SEGMENT_IDS[part.segment[4 * i]!]!;
      boneOutside[id] = (boneOutside[id] ?? 0) + 100 / boneCount;
    });
  }

  return {
    body: bodyId,
    boneOutside,
    atlas: atlasId,
    bodyHeight,
    ok: fitted.ok,
    outOfBand,
    ends: {
      wrist: { before: before.wrist, after: after.wrist },
      ankle: { before: before.ankle, after: after.ankle },
      "toe tip": { before: before["toe tip"], after: after["toe tip"] },
      fingertip: { before: before.fingertip, after: after.fingertip },
      crown: { before: before.crown, after: after.crown },
    },
    skeletonHeight: {
      before: extent(bones.flatMap((part) => part.before)) / bodyHeight,
      after: extent(bones.flatMap((part) => part.after)) / bodyHeight,
    },
    atlasSkeletonShare: span(ownBones) / span(ownSkinHeights),
    inside: {
      skeleton: share((layer) => layer === "skeleton"),
      organs: share((layer) => layer === "organs"),
      hands: share(
        (layer, segment) => layer === "skeleton" && segment.startsWith("hand"),
      ),
      feet: share((layer, segment) => layer === "skeleton" && segment.startsWith("foot")),
    },
  };
};

export const measureSegmentFit = async (
  dir: string,
  atlases: readonly AtlasId[] = ATLAS_IDS,
): Promise<readonly PairMeasure[]> => {
  const results: PairMeasure[] = [];
  for (const bodyId of DEMO_BODY_IDS) {
    const root = await load(riggedBodyFilePath(dir, bodyId));
    const binding = bindRig(root);
    const body = binding && readBody(root, binding);
    if (!body) throw new Error(`${bodyId}: body not read`);
    const skin = bodySkin(root);
    const inside = insideSkin(skin);
    for (const atlasId of atlases) {
      const scene = await load(atlasFilePath(dir, atlasId));
      results.push(measurePair(bodyId, body, skin, inside, atlasId, scene));
    }
  }
  return results;
};

// --- Printing ----------------------------------------------------------------------

const BODY_LABEL: Readonly<Record<DemoBodyId, string>> = {
  "anny-adult-m": "Male",
  "anny-adult-f": "Female",
};
const ATLAS_LABEL: Readonly<Record<AtlasId, string>> = {
  bodyparts3d: "BodyParts3D",
  "hra-f": "HRA female",
  "hra-m": "HRA male",
};

const cm = (values: readonly number[]): string =>
  values.map((value) => value.toFixed(1)).join(" / ");
const pct = (value: number): string =>
  Number.isNaN(value) ? "–" : `${value.toFixed(1)} %`;

if ((import.meta as { main?: boolean }).main) {
  const results = await measureSegmentFit(anatomyDir());
  process.stdout.write(
    "| Body | Atlas | Shown | Wrist L / R | Ankle L / R | Toe tip L / R | Fingertip L / R | Crown |\n",
  );
  for (const r of results) {
    const row = (when: "before" | "after") =>
      END_NAMES.map((name) => cm(r.ends[name][when])).join(" | ");
    process.stdout.write(
      `| ${BODY_LABEL[r.body]} | ${ATLAS_LABEL[r.atlas]} | ${r.ok ? "yes" : "no"} | ${row("after")} |  (before: ${row("before")})\n`,
    );
  }
  process.stdout.write(
    "\n| Body | Atlas | Skeleton height / body (before → after) | Atlas's own skeleton / skin |\n",
  );
  for (const r of results) {
    process.stdout.write(
      `| ${BODY_LABEL[r.body]} | ${ATLAS_LABEL[r.atlas]} | ${r.skeletonHeight.before.toFixed(4)} → ${r.skeletonHeight.after.toFixed(4)} | ${r.atlasSkeletonShare.toFixed(4)} |\n`,
    );
  }
  process.stdout.write(
    "\n| Body | Atlas | Skeleton | Organs | Hand bones | Foot bones |\n",
  );
  for (const r of results) {
    const s = (v: Share): string => `${pct(v.before)} → ${pct(v.after)}`;
    process.stdout.write(
      `| ${BODY_LABEL[r.body]} | ${ATLAS_LABEL[r.atlas]} | ${s(r.inside.skeleton)} | ${s(r.inside.organs)} | ${s(r.inside.hands)} | ${s(r.inside.feet)} |\n`,
    );
  }
  for (const r of results) {
    const worst = Object.entries(r.boneOutside)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, value]) => `${id} ${value.toFixed(1)}`);
    process.stdout.write(
      `\n${BODY_LABEL[r.body]} × ${ATLAS_LABEL[r.atlas]} bones outside, points of all: ${worst.join(", ")}`,
    );
  }
  for (const r of results) {
    if (r.outOfBand.length > 0)
      process.stdout.write(
        `\n${BODY_LABEL[r.body]} × ${ATLAS_LABEL[r.atlas]} out of band: ${r.outOfBand.join(", ")}`,
      );
  }
  process.stdout.write(
    `\nBody heights: ${[...new Set(results.map((r) => `${BODY_LABEL[r.body]} ${r.bodyHeight.toFixed(4)} m`))].join(", ")}\n`,
  );
}
