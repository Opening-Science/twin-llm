/**
 * Host CLI: measure each pinned atlas's joint centres from its bones.
 *
 *   bun run anatomy:measure-joints
 *
 * Prints the table for `packages/anatomy/atlas-joints.ts`, in each atlas's own
 * frame (metres, +Y up, +X the subject's left). Run it again when an atlas pin
 * moves; `atlas-joints.test.ts` fails until the table follows.
 *
 * Joints come from the long bones, as `scripts/blender/twinblend/atlas_rig.py`
 * finds them: hip and shoulder are the centres of spheres fitted to the
 * femoral and humeral heads, the knee lies between the femur's lower end and
 * the tibia's upper end, the ankle between the lower ends of tibia and
 * fibula, elbow and wrist likewise from humerus, radius and ulna, and the
 * neck is the first cervical vertebra. BodyParts3D names every bone
 * (`_structure`). HRA has leg bones only, as loose parts of its knee meshes;
 * its arms hold no anatomy, so their joints are placed along the arm's skin
 * by typical proportions, which is enough to tell arm skin from chest skin.
 */
import { readFileSync } from "node:fs";

import { type BufferAttribute, type Mesh, type Object3D, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { ATLAS_IDS, ATLASES, type AtlasId } from "../../packages/anatomy/manifest";
import { atlasFilePath, resolveAnatomyDir } from "../../packages/anatomy/paths";
import { SIDES, type Joints, type Side } from "../../packages/anatomy/segments";

type Points = readonly Vector3[];

const mean = (points: Points): Vector3 =>
  points
    .reduce((sum, point) => sum.add(point), new Vector3())
    .multiplyScalar(1 / points.length);

/** The mean of the points within `depth` of the bone's upper or lower end. */
export const bandCentre = (
  points: Points,
  end: "top" | "bottom",
  depth: number,
): Vector3 => {
  const ys = points.map((point) => point.y);
  const edge = end === "top" ? Math.max(...ys) : Math.min(...ys);
  return mean(points.filter((point) => Math.abs(point.y - edge) <= depth));
};

/** Solves a small linear system by Gaussian elimination with pivoting. */
const solve = (rows: readonly (readonly number[])[]): readonly number[] => {
  const m = rows.map((row) => [...row]);
  const n = m.length;
  for (let col = 0; col < n; col += 1) {
    const pivot = m
      .slice(col)
      .reduce(
        (best, row, i) =>
          Math.abs(row[col]!) > Math.abs(m[best]![col]!) ? col + i : best,
        col,
      );
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k += 1) m[row]![k]! -= factor * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
};

/** Least-squares sphere through the points: |p|² = 2 c·p + (r² − |c|²). */
export const fitSphere = (
  points: Points,
): Readonly<{ centre: Vector3; radius: number }> => {
  const rows = points.map((p) => [2 * p.x, 2 * p.y, 2 * p.z, 1, p.lengthSq()]);
  const normal = [0, 1, 2, 3].map((i) =>
    [0, 1, 2, 3, 4].map((j) => rows.reduce((sum, row) => sum + row[i]! * row[j]!, 0)),
  );
  const [x, y, z, rest] = solve(normal) as [number, number, number, number];
  const centre = new Vector3(x, y, z);
  return { centre, radius: Math.sqrt(Math.max(0, rest + centre.lengthSq())) };
};

/**
 * The centre of a femoral or humeral head: a sphere through the cap around
 * the innermost point of the bone's top. `k` scales lengths to the atlas
 * (1 at 1.70 m).
 */
export const headCentre = (points: Points, side: Side, k: number): Vector3 => {
  const top = Math.max(...points.map((point) => point.y));
  const upper = points.filter((point) => point.y >= top - 0.1 * k);
  const inward = side === "L" ? 1 : -1;
  const innermost = upper.reduce((best, point) =>
    inward * point.x < inward * best.x ? point : best,
  );
  const cap = upper.filter((point) => point.distanceTo(innermost) <= 0.035 * k);
  const { centre, radius } = fitSphere(cap);
  return cap.length >= 12 && radius >= 0.012 * k && radius <= 0.04 * k
    ? centre
    : mean(cap);
};

export type LongBones = Readonly<{
  femur: Points;
  tibia: Points;
  fibula: Points;
  arm: Readonly<{ humerus: Points; radius: Points; ulna: Points }> | null;
}>;

type LimbJoints = Readonly<{
  hip: Vector3;
  knee: Vector3;
  ankle: Vector3;
  arm: Readonly<{ shoulder: Vector3; elbow: Vector3; wrist: Vector3 }> | null;
}>;

/** One side's joints from its long bones. */
export const limbJoints = (bones: LongBones, side: Side, k: number): LimbJoints => {
  const between = (a: Vector3, b: Vector3): Vector3 => a.add(b).multiplyScalar(0.5);
  const { arm } = bones;
  return {
    hip: headCentre(bones.femur, side, k),
    knee: between(
      bandCentre(bones.femur, "bottom", 0.02 * k),
      bandCentre(bones.tibia, "top", 0.02 * k),
    ),
    ankle: between(
      bandCentre(bones.tibia, "bottom", 0.015 * k),
      bandCentre(bones.fibula, "bottom", 0.015 * k),
    ),
    arm: arm && {
      shoulder: headCentre(arm.humerus, side, k),
      elbow: between(
        bandCentre(arm.humerus, "bottom", 0.02 * k),
        between(
          bandCentre(arm.radius, "top", 0.015 * k),
          bandCentre(arm.ulna, "top", 0.015 * k),
        ),
      ),
      wrist: between(
        bandCentre(arm.radius, "bottom", 0.015 * k),
        bandCentre(arm.ulna, "bottom", 0.015 * k),
      ),
    },
  };
};

/**
 * Where an arm's joints lie for an atlas without arm bones, as BodyParts3D
 * has them: the shoulder out and down from the neck by these shares of body
 * height, the elbow and wrist at these shares of the way out to the fingertip.
 */
const ARM_SHARES = { out: 0.094, down: 0.091, elbow: 0.41, wrist: 0.75 } as const;

/**
 * Arm joints from the neck and the arm's skin, for arms held out sideways:
 * elbow and wrist are the middle of the skin at their distance from the
 * shoulder. `arm` are the skin points beside the trunk on that side, above
 * the legs. Enough to tell arm skin from chest skin.
 */
export const armFromSkin = (
  neck: Vector3,
  arm: Points,
  side: Side,
  height: number,
): Readonly<{ shoulder: Vector3; elbow: Vector3; wrist: Vector3 }> => {
  const sign = side === "L" ? 1 : -1;
  const shoulder = new Vector3(
    neck.x + sign * ARM_SHARES.out * height,
    neck.y - ARM_SHARES.down * height,
    neck.z,
  );
  const reach = Math.max(...arm.map((point) => sign * point.x)) - sign * shoulder.x;
  const at = (share: number): Vector3 => {
    const x = sign * shoulder.x + share * reach;
    return mean(arm.filter((point) => Math.abs(sign * point.x - x) <= 0.03 * reach));
  };
  return { shoulder, elbow: at(ARM_SHARES.elbow), wrist: at(ARM_SHARES.wrist) };
};

/** Connected pieces of an indexed mesh, largest first, as lists of vertex indices. */
export const looseParts = (index: ArrayLike<number>, count: number): number[][] => {
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    let node = i;
    while (parent[node] !== root) {
      const next = parent[node]!;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  for (let i = 0; i < index.length; i += 3) {
    const a = find(index[i]!);
    parent[find(index[i + 1]!)] = a;
    parent[find(index[i + 2]!)] = a;
  }
  const parts = new Map<number, number[]>();
  for (let i = 0; i < count; i += 1) {
    const root = find(i);
    parts.set(root, [...(parts.get(root) ?? []), i]);
  }
  return [...parts.values()].sort((a, b) => b.length - a.length);
};

// --- Reading the pinned files --------------------------------------------------

const load = async (id: AtlasId): Promise<Object3D> => {
  const dir = resolveAnatomyDir(process.env.ANATOMY_DATA_DIR, process.cwd());
  const bytes = readFileSync(atlasFilePath(dir, id));
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

const meshes = (root: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) found.push(object as Mesh);
  });
  return found;
};

const worldPoints = (
  mesh: Mesh,
  keep: (vertex: number) => boolean = () => true,
): Vector3[] => {
  const position = mesh.geometry.getAttribute("position");
  const points: Vector3[] = [];
  for (let i = 0; i < position.count; i += 1) {
    if (!keep(i)) continue;
    points.push(
      new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
    );
  }
  return points;
};

const height = (root: Object3D): number => {
  const ys = meshes(root).flatMap((mesh) => worldPoints(mesh).map((point) => point.y));
  return (
    ys.reduce((a, b) => Math.max(a, b), -Infinity) -
    ys.reduce((a, b) => Math.min(a, b), Infinity)
  );
};

const bodyParts3dJoints = (root: Object3D): Joints => {
  const k = height(root) / 1.7;
  const bone = meshes(root).find((mesh) => mesh.userData.layer === "bone") as Mesh;
  const structure = bone.geometry.getAttribute("_structure") as BufferAttribute;
  const names = (
    bone.parent?.userData.structures as readonly Readonly<{ name: string }>[]
  ).map((entry) => entry.name);
  const named = (...wanted: string[]): Vector3[] =>
    worldPoints(bone, (vertex) => wanted.includes(names[structure.getX(vertex)] ?? ""));
  const sides = SIDES.map((side) => {
    const word = side === "L" ? "left" : "right";
    return limbJoints(
      {
        // The right femur is filed as "right thigh" in the pinned file.
        femur: named(`${word} femur`, `${word} thigh`),
        tibia: named(`${word} tibia`),
        fibula: named(`${word} fibula`),
        arm: {
          humerus: named(`${word} humerus`),
          radius: named(`${word} radius`),
          ulna: named(`${word} ulna`),
        },
      },
      side,
      k,
    );
  });
  return toJoints(sides, mean(named("atlas")));
};

const hraJoints = (root: Object3D): Joints => {
  const k = height(root) / 1.7;
  const all = meshes(root);
  const group = (mesh: Mesh): string =>
    String(mesh.userData.anatomical_structure_of ?? "").toLowerCase();
  const skin = worldPoints(all.find((mesh) => group(mesh).includes("skin")) as Mesh);
  const spine = worldPoints(
    all.find((mesh) => group(mesh).includes("vertebrae")) as Mesh,
  );
  const neck = bandCentre(spine, "top", 0.02 * k);
  const legs = SIDES.map((side) => {
    const sign = side === "L" ? 1 : -1;
    // The bones only: the knee's muscles and ligaments are meshes of their own.
    const knee = all.find((mesh) =>
      new RegExp(`^#vh.${side === "L" ? "left" : "right"}knee$`).test(group(mesh)),
    ) as Mesh;
    const points = worldPoints(knee);
    const long = looseParts(knee.geometry.index?.array ?? [], points.length)
      .map((part) => part.map((vertex) => points[vertex]!))
      .filter((part) => {
        const ys = part.map((point) => point.y);
        return Math.max(...ys) - Math.min(...ys) > 0.17 * k;
      })
      .sort((a, b) => mean(b).y - mean(a).y);
    const [femur, ...lower] = long as [Vector3[], Vector3[], Vector3[]];
    const [tibia, fibula] = lower.sort((a, b) => sign * (mean(a).x - mean(b).x));
    return {
      ...limbJoints({ femur, tibia: tibia!, fibula: fibula!, arm: null }, side, k),
      arm: null,
    };
  });
  const hipHeight = (legs[0]!.hip.y + legs[1]!.hip.y) / 2;
  const sides = legs.map((leg, i) => ({
    ...leg,
    arm: armFromSkin(
      neck,
      skin.filter((point) => point.y > hipHeight - 0.1 * k),
      SIDES[i]!,
      1.7 * k,
    ),
  }));
  return toJoints(sides, neck);
};

const toJoints = (sides: readonly LimbJoints[], neck: Vector3): Joints => {
  const per = (pick: (limb: LimbJoints) => Vector3 | undefined) =>
    Object.fromEntries(SIDES.map((side, i) => [side, pick(sides[i]!)])) as Record<
      Side,
      Vector3
    >;
  return {
    hip: per((limb) => limb.hip),
    knee: per((limb) => limb.knee),
    ankle: per((limb) => limb.ankle),
    shoulder: per((limb) => limb.arm?.shoulder),
    elbow: per((limb) => limb.arm?.elbow),
    wrist: per((limb) => limb.arm?.wrist),
    neck,
  };
};

const printed = (joints: Joints): string => {
  const point = (v: Vector3): string =>
    `[${v
      .toArray()
      .map((value) => value.toFixed(4))
      .join(", ")}]`;
  const rows = Object.entries(joints).map(([name, value]) =>
    value instanceof Vector3
      ? `    ${name}: ${point(value)},`
      : `    ${name}: { L: ${point(value.L)}, R: ${point(value.R)} },`,
  );
  return rows.join("\n");
};

if ((import.meta as { main?: boolean }).main) {
  for (const id of ATLAS_IDS) {
    const root = await load(id);
    const joints =
      ATLASES[id].scheme === "hra" ? hraJoints(root) : bodyParts3dJoints(root);
    process.stdout.write(`  "${id}": {\n${printed(joints)}\n  },\n`);
  }
}
