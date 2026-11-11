import { Vector3 } from "three";

import { type AtlasId } from "./manifest";
import { SIDES, type Joints, type PerSide } from "./segments";

/**
 * Each pinned atlas's joint centres in its own frame (metres, +Y up, +X the
 * subject's left), measured from its bones by `bun run anatomy:measure-joints`
 * (2026-11-11; the method is in that script and in docs/anatomy.md). HRA has
 * no arm bones and no anatomy in its arms: its arm joints are placed along the
 * arm's skin and only tell arm skin from chest skin.
 */
type Point = readonly [number, number, number];
type Table = Readonly<{
  hip: PerSide<Point>;
  knee: PerSide<Point>;
  ankle: PerSide<Point>;
  shoulder: PerSide<Point>;
  elbow: PerSide<Point>;
  wrist: PerSide<Point>;
  neck: Point;
}>;

const TABLE: Readonly<Record<AtlasId, Table>> = {
  bodyparts3d: {
    hip: { L: [0.0863, 0.8793, 0.078], R: [-0.0862, 0.8793, 0.0781] },
    knee: { L: [0.0723, 0.4446, 0.0763], R: [-0.072, 0.4446, 0.076] },
    ankle: { L: [0.0804, 0.0697, 0.0666], R: [-0.0799, 0.0694, 0.0664] },
    shoulder: { L: [0.1604, 1.3771, 0.0747], R: [-0.1603, 1.3772, 0.0749] },
    elbow: { L: [0.2122, 1.105, 0.0661], R: [-0.2119, 1.105, 0.0662] },
    wrist: { L: [0.2472, 0.8801, 0.1131], R: [-0.2482, 0.8801, 0.1139] },
    neck: [-0.0015, 1.532, 0.0676],
  },
  "hra-f": {
    hip: { L: [0.0913, 0.0153, -0.0624], R: [-0.1121, 0.0153, -0.0587] },
    knee: { L: [0.1143, -0.3812, -0.0786], R: [-0.1353, -0.3811, -0.0747] },
    ankle: { L: [0.1376, -0.7194, -0.0923], R: [-0.1588, -0.7194, -0.0886] },
    shoulder: { L: [0.1416, 0.5544, -0.0621], R: [-0.1701, 0.5544, -0.0621] },
    elbow: { L: [0.2773, 0.2431, -0.0631], R: [-0.3001, 0.2362, -0.0656] },
    wrist: { L: [0.3906, 0.0244, -0.0253], R: [-0.4084, 0.027, -0.025] },
    neck: [-0.0143, 0.7052, -0.0621],
  },
  "hra-m": {
    hip: { L: [0.0954, 0.0291, -0.0061], R: [-0.0901, 0.0302, -0.0023] },
    knee: { L: [0.1437, -0.4237, -0.0264], R: [-0.1378, -0.4227, -0.0228] },
    ankle: { L: [0.2107, -0.8229, -0.0848], R: [-0.2055, -0.8217, -0.0811] },
    shoulder: { L: [0.1686, 0.5835, -0.0007], R: [-0.1744, 0.5835, -0.0007] },
    elbow: { L: [0.313, 0.2561, -0.0178], R: [-0.3162, 0.2301, -0.0182] },
    wrist: { L: [0.4347, 0.0112, 0.0195], R: [-0.4358, 0.0298, 0.015] },
    neck: [-0.0029, 0.7495, -0.0007],
  },
};

/** The atlas files the table was measured on; a test fails when a pin moves. */
export const ATLAS_JOINTS_MEASURED_ON: Readonly<Record<AtlasId, string>> = {
  bodyparts3d: "a65116b5ac9e33f37794e0f364bbf1375e29af3212a458caace107a983274855",
  "hra-f": "37468cf1180b0367a698d40eefd962df0b12a53c1ce74a29d8b70a8af5dc0eb1",
  "hra-m": "5d820f289a529ef6ee6d2a1158c867d33f25dceaf269eebbbcd46f85b602addc",
};

const perSide = (points: PerSide<Point>): PerSide<Vector3> =>
  Object.fromEntries(
    SIDES.map((side) => [side, new Vector3(...points[side])]),
  ) as PerSide<Vector3>;

export const atlasJoints = (id: AtlasId): Joints => {
  const row = TABLE[id];
  return {
    hip: perSide(row.hip),
    knee: perSide(row.knee),
    ankle: perSide(row.ankle),
    shoulder: perSide(row.shoulder),
    elbow: perSide(row.elbow),
    wrist: perSide(row.wrist),
    neck: new Vector3(...row.neck),
  };
};
