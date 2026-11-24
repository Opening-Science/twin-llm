/**
 * Which atlas bones a CT skeleton replaces.
 *
 * The open-anatomy CT skeleton covers part of the body (Stage 1: the trunk
 * from T1 to the pelvis). With it on, the atlas keeps drawing every bone the
 * CT build does not have, so the skull, neck, shoulders and limbs stay, and
 * hides only the bones the CT build has, so nothing is drawn twice.
 *
 * - CT side: each bone's English name (`extras.name`, "left fifth rib") gives
 *   its region.
 * - HRA: one node per structure group, read from its name.
 * - BodyParts3D: all its bones are one mesh and its discs another, so each
 *   connected piece is matched by its centre against a table checked by eye
 *   against the pinned file (`bodyparts3d.ao.glb`, SHA-256 a65116b5…4855).
 *   Centres are in the mesh's own quantised frame, as the loader reads it; a
 *   piece matches within MATCH_TOLERANCE. A piece the table does not name is
 *   always kept.
 */
export type CtRegion =
  | "rib"
  | "thoracic-vertebra"
  | "lumbar-vertebra"
  | "sacrum"
  | "hip-bone"
  | "sternum"
  | "costal-cartilage";

/** An atlas structure the CT may replace; discs go with their vertebrae. */
export type AtlasRegion = CtRegion | "thoracic-disc" | "lumbar-disc";

const CT_NAMES: readonly (readonly [RegExp, CtRegion])[] = [
  [/\brib$/i, "rib"],
  [/\bthoracic vertebra$/i, "thoracic-vertebra"],
  [/\blumbar vertebra$/i, "lumbar-vertebra"],
  [/^sacrum$/i, "sacrum"],
  [/\bhip bone$/i, "hip-bone"],
  [/^(sternum|manubrium)/i, "sternum"],
  [/\bcostal cartilages?$/i, "costal-cartilage"],
];

/** The region a CT bone's English name falls in, or null. */
export const ctRegion = (name: string): CtRegion | null =>
  CT_NAMES.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;

/** Every region a CT build has at least one bone in. */
export const ctRegions = (names: readonly string[]): ReadonlySet<CtRegion> =>
  new Set(names.map(ctRegion).filter((region) => region !== null));

const DISC_OF: Readonly<Record<"thoracic-disc" | "lumbar-disc", CtRegion>> = {
  "thoracic-disc": "thoracic-vertebra",
  "lumbar-disc": "lumbar-vertebra",
};

/** Whether the CT build has this atlas structure, so the atlas hides it. */
export const replacedByCt = (
  region: AtlasRegion,
  covered: ReadonlySet<CtRegion>,
): boolean =>
  covered.has(
    region === "thoracic-disc" || region === "lumbar-disc" ? DISC_OF[region] : region,
  );

const HRA_NAMES: readonly (readonly [RegExp, AtlasRegion])[] = [
  [/Pelvis$/, "hip-bone"],
  [/Vertebrae$/, "thoracic-vertebra"],
  [/IntervertebralDisk$/, "thoracic-disc"],
  [/_(sternum|manubrium)$/, "sternum"],
];

/** The region of an HRA node, from its name (`#VHMPelvis`, `VH_F_sternum`), or null. */
export const hraRegion = (name: string): AtlasRegion | null =>
  HRA_NAMES.find(([pattern]) => pattern.test(name))?.[1] ?? null;

export type Vec3 = readonly [number, number, number];

/** A BodyParts3D piece the CT may replace: its mesh, region, name and centre. */
export type TrunkPiece = readonly [
  mesh: "bone" | "connective",
  region: AtlasRegion,
  label: string,
  centre: Vec3,
];

/** How far a piece's centre may sit from the table's, in the mesh's quantised units. */
export const MATCH_TOLERANCE = 0.002;

/**
 * BodyParts3D's trunk pieces in the pinned file: T1 to L5, the sacrum, both hip
 * bones, 24 ribs and the discs from T1/T2 to L5/S1. It has no sternum and no
 * costal cartilage. The neck, collarbones, shoulder blades and limbs are not
 * listed, so they always stay.
 */
export const BODYPARTS3D_TRUNK: readonly TrunkPiece[] = [
  ["bone", "thoracic-vertebra", "first thoracic vertebra", [-0.0016, 0.6785, -0.057]],
  ["bone", "thoracic-vertebra", "second thoracic vertebra", [-0.0007, 0.6595, -0.0641]],
  ["bone", "thoracic-vertebra", "third thoracic vertebra", [-0.0004, 0.6342, -0.0769]],
  ["bone", "thoracic-vertebra", "fourth thoracic vertebra", [-0.0004, 0.6067, -0.0862]],
  ["bone", "thoracic-vertebra", "fifth thoracic vertebra", [-0.001, 0.5767, -0.0933]],
  ["bone", "thoracic-vertebra", "sixth thoracic vertebra", [-0.0021, 0.545, -0.0966]],
  ["bone", "thoracic-vertebra", "seventh thoracic vertebra", [-0.0003, 0.5107, -0.0961]],
  ["bone", "thoracic-vertebra", "eighth thoracic vertebra", [-0.0017, 0.4768, -0.0914]],
  ["bone", "thoracic-vertebra", "ninth thoracic vertebra", [-0.001, 0.4462, -0.0871]],
  ["bone", "thoracic-vertebra", "tenth thoracic vertebra", [-0.0011, 0.4114, -0.0808]],
  ["bone", "thoracic-vertebra", "eleventh thoracic vertebra", [-0.0001, 0.3797, -0.0724]],
  ["bone", "thoracic-vertebra", "twelfth thoracic vertebra", [-0.0015, 0.3463, -0.0624]],
  ["bone", "lumbar-vertebra", "first lumbar vertebra", [-0.0011, 0.3087, -0.0535]],
  ["bone", "lumbar-vertebra", "second lumbar vertebra", [-0.0014, 0.2759, -0.0473]],
  ["bone", "lumbar-vertebra", "third lumbar vertebra", [-0.0015, 0.2432, -0.0475]],
  ["bone", "lumbar-vertebra", "fourth lumbar vertebra", [0.0, 0.2111, -0.0518]],
  ["bone", "lumbar-vertebra", "fifth lumbar vertebra", [-0.001, 0.1759, -0.062]],
  ["bone", "sacrum", "sacrum", [-0.0003, 0.1035, -0.0934]],
  ["bone", "hip-bone", "right hip bone", [-0.0806, 0.072, -0.0435]],
  ["bone", "hip-bone", "left hip bone", [0.0801, 0.0731, -0.0429]],
  ["bone", "rib", "right first rib", [-0.0505, 0.6589, -0.0224]],
  ["bone", "rib", "left first rib", [0.0495, 0.658, -0.0216]],
  ["bone", "rib", "right second rib", [-0.0657, 0.6398, -0.0242]],
  ["bone", "rib", "left second rib", [0.0643, 0.6392, -0.023]],
  ["bone", "rib", "left third rib", [0.0724, 0.611, -0.0317]],
  ["bone", "rib", "right third rib", [-0.0711, 0.6098, -0.0287]],
  ["bone", "rib", "left fourth rib", [0.0826, 0.5748, -0.0284]],
  ["bone", "rib", "right fourth rib", [-0.0831, 0.5742, -0.0271]],
  ["bone", "rib", "left fifth rib", [0.0873, 0.5437, -0.0425]],
  ["bone", "rib", "right fifth rib", [-0.0881, 0.5435, -0.042]],
  ["bone", "rib", "right sixth rib", [-0.0991, 0.5021, -0.0444]],
  ["bone", "rib", "left sixth rib", [0.0979, 0.5018, -0.043]],
  ["bone", "rib", "left seventh rib", [0.0923, 0.4739, -0.0573]],
  ["bone", "rib", "right seventh rib", [-0.0964, 0.4721, -0.0563]],
  ["bone", "rib", "left eighth rib", [0.0918, 0.4365, -0.0624]],
  ["bone", "rib", "right eighth rib", [-0.095, 0.434, -0.0591]],
  ["bone", "rib", "right ninth rib", [-0.0859, 0.4075, -0.072]],
  ["bone", "rib", "left ninth rib", [0.0864, 0.4057, -0.0724]],
  ["bone", "rib", "left tenth rib", [0.0792, 0.3733, -0.0727]],
  ["bone", "rib", "right tenth rib", [-0.082, 0.3715, -0.0707]],
  ["bone", "rib", "left eleventh rib", [0.0735, 0.3379, -0.0709]],
  ["bone", "rib", "right eleventh rib", [-0.0769, 0.3359, -0.069]],
  ["bone", "rib", "left twelfth rib", [0.0559, 0.3201, -0.0706]],
  ["bone", "rib", "right twelfth rib", [-0.0583, 0.3189, -0.0699]],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T1/T2",
    [-0.0007, 0.4695, -0.1523],
  ],
  ["connective", "thoracic-disc", "intervertebral disc T2/T3", [0.0008, 0.4036, -0.175]],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T3/T4",
    [-0.0006, 0.3329, -0.1981],
  ],
  ["connective", "thoracic-disc", "intervertebral disc T4/T5", [0.0009, 0.261, -0.2252]],
  ["connective", "thoracic-disc", "intervertebral disc T5/T6", [0.0012, 0.1806, -0.2347]],
  ["connective", "thoracic-disc", "intervertebral disc T6/T7", [0.003, 0.0977, -0.2404]],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T7/T8",
    [-0.0007, 0.0091, -0.2277],
  ],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T8/T9",
    [0.0005, -0.0733, -0.2072],
  ],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T9/T10",
    [0.0006, -0.1573, -0.1827],
  ],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T10/T11",
    [0.0004, -0.2481, -0.1653],
  ],
  [
    "connective",
    "thoracic-disc",
    "intervertebral disc T11/T12",
    [-0.0017, -0.3399, -0.1429],
  ],
  ["connective", "lumbar-disc", "intervertebral disc T12/L1", [0.0032, -0.4351, -0.117]],
  ["connective", "lumbar-disc", "intervertebral disc L1/L2", [-0.0008, -0.5318, -0.0871]],
  ["connective", "lumbar-disc", "intervertebral disc L2/L3", [-0.0017, -0.6355, -0.077]],
  ["connective", "lumbar-disc", "intervertebral disc L3/L4", [-0.0016, -0.7448, -0.0891]],
  ["connective", "lumbar-disc", "intervertebral disc L4/L5", [-0.0008, -0.8446, -0.114]],
  ["connective", "lumbar-disc", "intervertebral disc L5/S1", [-0.001, -0.9527, -0.1545]],
];

/** The table entry a BodyParts3D piece's centre matches, or null. */
export const matchTrunkPiece = (
  mesh: "bone" | "connective",
  centre: Vec3,
): TrunkPiece | null =>
  BODYPARTS3D_TRUNK.find(
    ([kind, , , at]) =>
      kind === mesh &&
      Math.hypot(at[0] - centre[0], at[1] - centre[1], at[2] - centre[2]) <=
        MATCH_TOLERANCE,
  ) ?? null;

/**
 * The BodyParts3D mesh a node name stands for (`musculoskeletal/bone`, which
 * three.js may load as `musculoskeletalbone`), or null for any other mesh.
 */
export const bodyParts3dMesh = (name: string): "bone" | "connective" | null =>
  /^musculoskeletal[/_]?bone$/.test(name)
    ? "bone"
    : /^musculoskeletal[/_]?connective$/.test(name)
      ? "connective"
      : null;

export type Pieces = Readonly<{
  /** Each piece's triangles, as triangle numbers into the index. */
  triangles: readonly (readonly number[])[];
  centres: readonly Vec3[];
  /** Each piece's box, lowest then highest corner. */
  boxes: readonly (readonly [Vec3, Vec3])[];
}>;

/**
 * Splits an indexed triangle mesh into connected pieces. Vertices at the same
 * position (to 1e-5) count as joined, since a mesh split for normals or
 * colours repeats them. A piece's centre is the mean of its distinct vertices.
 */
export const meshPieces = (
  position: ArrayLike<number>,
  index: ArrayLike<number>,
): Pieces => {
  const count = position.length / 3;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const root = (start: number): number => {
    let at = start;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }
    return at;
  };
  const join = (a: number, b: number): void => {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const seen = new Map<string, number>();
  for (let v = 0; v < count; v += 1) {
    const key = `${Math.round(position[v * 3] * 1e5)},${Math.round(position[v * 3 + 1] * 1e5)},${Math.round(position[v * 3 + 2] * 1e5)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, v);
    else join(first, v);
  }
  for (let t = 0; t + 2 < index.length; t += 3) {
    join(index[t], index[t + 1]);
    join(index[t], index[t + 2]);
  }
  const pieceOf = new Map<number, number>();
  const sums: number[][] = [];
  const lows: number[][] = [];
  const highs: number[][] = [];
  for (const [, v] of seen) {
    const r = root(v);
    let piece = pieceOf.get(r);
    if (piece === undefined) {
      piece = sums.length;
      pieceOf.set(r, piece);
      sums.push([0, 0, 0, 0]);
      lows.push([Infinity, Infinity, Infinity]);
      highs.push([-Infinity, -Infinity, -Infinity]);
    }
    const sum = sums[piece];
    for (let axis = 0; axis < 3; axis += 1) {
      const value = position[v * 3 + axis];
      sum[axis] += value;
      lows[piece][axis] = Math.min(lows[piece][axis], value);
      highs[piece][axis] = Math.max(highs[piece][axis], value);
    }
    sum[3] += 1;
  }
  const triangles: number[][] = sums.map(() => []);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const piece = pieceOf.get(root(index[t]));
    if (piece !== undefined) triangles[piece].push(t / 3);
  }
  return {
    triangles,
    centres: sums.map(([x, y, z, n]): Vec3 => [x / n, y / n, z / n]),
    boxes: lows.map((low, piece): readonly [Vec3, Vec3] => [
      [low[0], low[1], low[2]],
      [highs[piece][0], highs[piece][1], highs[piece][2]],
    ]),
  };
};

/**
 * Reorders an index so the dropped pieces' triangles come last, and returns
 * how many index entries are kept: drawing that many draws only the kept
 * pieces. The order within each group is kept.
 */
export const keptFirst = (
  index: ArrayLike<number>,
  pieces: Pieces,
  dropped: (centre: Vec3) => boolean,
): Readonly<{ index: number[]; kept: number }> => {
  const keep: number[] = [];
  const drop: number[] = [];
  pieces.triangles.forEach((triangles, piece) => {
    const into = dropped(pieces.centres[piece]) ? drop : keep;
    for (const t of triangles) into.push(t);
  });
  const order = [...keep.sort((a, b) => a - b), ...drop.sort((a, b) => a - b)];
  const out = order.flatMap((t) => [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]);
  return { index: out, kept: keep.length * 3 };
};
