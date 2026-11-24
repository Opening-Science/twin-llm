import { describe, expect, test } from "bun:test";
import { Matrix4, Vector3 } from "three";

import {
  AVERAGE_FIGURE,
  HEAVY_FIGURE,
  syntheticFigure,
  type Figure,
} from "./fixtures/synthetic-figure";
import {
  boneWeights,
  buildSegments,
  FIT_ALONG_BAND,
  fitMatrices,
  labelPoints,
  measureSkin,
  SEGMENT_IDS,
  segmentsFromSkin,
  skinWeights,
  trunkFrame,
  type Joints,
  type Segments,
} from "./segments";

/** A figure's skin as the fit reads it: points, and the segment each belongs to. */
const skinOf = (figure: Figure, move = new Matrix4()) => {
  const points = figure.tubes.flatMap((tube) =>
    tube.rings.flat().flatMap((point) => point.clone().applyMatrix4(move).toArray()),
  );
  const labels = figure.tubes.flatMap((tube) =>
    tube.rings.flat().map(() => SEGMENT_IDS.indexOf(tube.segment)),
  );
  return { points: Float32Array.from(points), labels: Uint8Array.from(labels) };
};

const moved = (joints: Joints, move: Matrix4): Joints => {
  const at = (point: Vector3): Vector3 => point.clone().applyMatrix4(move);
  const both = (pair: Joints["hip"]) => ({ L: at(pair.L), R: at(pair.R) });
  return {
    hip: both(joints.hip),
    knee: both(joints.knee),
    ankle: both(joints.ankle),
    shoulder: both(joints.shoulder),
    elbow: both(joints.elbow),
    wrist: both(joints.wrist),
    neck: at(joints.neck),
  };
};

const segmentsOf = (figure: Figure, move = new Matrix4()): Segments => {
  const { points, labels } = skinOf(figure, move);
  const joints = moved(figure.joints, move);
  const skin = measureSkin(points, labels, joints);
  if (!skin) throw new Error("skin not measured");
  return buildSegments(joints, skin);
};

const average = syntheticFigure(AVERAGE_FIGURE);
const heavy = syntheticFigure(HEAVY_FIGURE);
/** A scan's frame and framing: +Z up, faces -Y, turned a little and off centre. */
const SCAN = new Matrix4()
  .makeTranslation(0.4, -0.2, 0.93)
  .multiply(new Matrix4().makeRotationZ(0.3))
  .multiply(new Matrix4().makeRotationX(Math.PI / 2));

describe("trunkFrame", () => {
  test("front is left × up in the atlas frame and in a scan's", () => {
    const atlas = trunkFrame(average.joints);
    expect(atlas.left.x).toBeCloseTo(1, 9);
    expect(atlas.axis.y).toBeCloseTo(1, 9);
    expect(atlas.front.z).toBeCloseTo(1, 9);
    expect(atlas.length).toBeCloseTo(AVERAGE_FIGURE.trunk, 9);
    const scan = trunkFrame(
      moved(average.joints, new Matrix4().makeRotationX(Math.PI / 2)),
    );
    expect(scan.axis.z).toBeCloseTo(1, 9);
    expect(scan.front.y).toBeCloseTo(-1, 9);
  });
});

describe("measureSkin", () => {
  const { points, labels } = skinOf(heavy);
  const skin = measureSkin(points, labels, heavy.joints);

  test("finds the crown, the toes and the fingertips where they were put", () => {
    expect(skin?.top).toBeCloseTo(HEAVY_FIGURE.head.top, 6);
    expect(skin?.toe.L.distanceTo(heavy.toe.L)).toBeLessThan(1e-6);
    expect(skin?.finger.R.distanceTo(heavy.finger.R)).toBeLessThan(1e-6);
  });

  test("measures each outline's size and centre", () => {
    const section = skin!.section;
    expect(section.abdomen.halfWidth).toBeCloseTo(HEAVY_FIGURE.abdomen[0], 2);
    expect(section.abdomen.halfDepth).toBeCloseTo(HEAVY_FIGURE.abdomen[1], 2);
    // The belly stands in front of the hips' line; the chest does not.
    expect(section.abdomen.near[1]).toBeCloseTo(HEAVY_FIGURE.belly, 2);
    expect(Math.abs(section.chest.near[1])).toBeLessThan(0.03);
    expect(section.neck.halfWidth).toBeCloseTo(HEAVY_FIGURE.neck[0], 2);
    expect(section.thighL.halfWidth).toBeCloseTo(HEAVY_FIGURE.radius.thigh, 2);
    expect(section.forearmR.halfDepth).toBeCloseTo(HEAVY_FIGURE.radius.forearm, 2);
    expect(section.head.halfWidth).toBeCloseTo(HEAVY_FIGURE.head.halfWidth, 2);
    // A tube around its own joint line has its centre on it.
    expect(Math.hypot(...section.shinL.near, ...section.shinL.far)).toBeLessThan(0.005);
  });

  test("points a hand through its middle, not at a thumb spread further", () => {
    const hand = SEGMENT_IDS.indexOf("handR");
    const wrist = heavy.joints.wrist.R;
    const way = heavy.finger.R.clone().sub(wrist);
    const across = new Vector3(0, 0, 1).cross(way).normalize();
    // A thumb of a few points, reaching 20 % further than the fingers, 40° off.
    const thumb = [0.6, 0.8, 1, 1.2].map((share) =>
      wrist
        .clone()
        .addScaledVector(way, share * Math.cos(0.7))
        .addScaledVector(across, share * way.length() * Math.sin(0.7)),
    );
    const withThumb = measureSkin(
      Float32Array.from([...points, ...thumb.flatMap((point) => point.toArray())]),
      Uint8Array.from([...labels, ...thumb.map(() => hand)]),
      heavy.joints,
    );
    const pointing = withThumb!.finger.R.clone().sub(wrist);
    expect(pointing.angleTo(way)).toBeLessThan((3 * Math.PI) / 180);
    // As far as the hand reaches that way: the fingertip, not the thumb.
    expect(Math.abs(pointing.length() / way.length() - 1)).toBeLessThan(0.02);
  });

  test("is null when a part has no skin", () => {
    const noHands = labels.map((label) =>
      SEGMENT_IDS[label]!.startsWith("hand") ? SEGMENT_IDS.indexOf("chest") : label,
    );
    expect(measureSkin(points, noHands, heavy.joints)).toBeNull();
  });
});

describe("a limb whose joint line is off centre", () => {
  test("is centred on its skin, not on the joints", () => {
    // The hip joints 4 cm further apart than the thighs they sit in.
    const wide: Joints = {
      ...average.joints,
      hip: {
        L: average.joints.hip.L.clone().add(new Vector3(0.04, 0, 0)),
        R: average.joints.hip.R.clone().add(new Vector3(-0.04, 0, 0)),
      },
    };
    const { points, labels } = skinOf(average);
    const segments = buildSegments(wide, measureSkin(points, labels, wide));
    const centre = segmentsOf(average).thighL;
    expect(segments.thighL.origin.distanceTo(centre.origin)).toBeLessThan(0.012);
    expect(segments.thighL.axis.dot(centre.axis)).toBeGreaterThan(0.999);
  });
});

describe("a limb pointing along the trunk's front or left", () => {
  const frameOf = (joints: Joints, id: "forearmL" | "thighL") =>
    buildSegments(joints, null)[id];
  const bent = (wrist: Vector3): Joints => ({
    ...average.joints,
    wrist: { ...average.joints.wrist, L: wrist },
  });
  const elbow = average.joints.elbow.L;

  test("a forearm held straight forward keeps a whole frame, its side turned up", () => {
    const forearm = frameOf(bent(elbow.clone().add(new Vector3(0, 0, 0.25))), "forearmL");
    expect(forearm.axis.z).toBeCloseTo(1, 9);
    expect(forearm.left.length()).toBeCloseTo(1, 9);
    expect(forearm.left.y).toBeCloseTo(1, 9);
    expect(forearm.front.length()).toBeCloseTo(1, 9);
  });

  test("the frame turns smoothly as the forearm swings from hanging to forward", () => {
    const at = (degrees: number): Vector3 => {
      const angle = (degrees * Math.PI) / 180;
      const wrist = elbow.clone().add(new Vector3(0, -Math.cos(angle), Math.sin(angle)));
      return frameOf(bent(wrist), "forearmL").left;
    };
    expect(at(0).z).toBeCloseTo(1, 9);
    for (let degrees = 0; degrees < 90; degrees += 5) {
      expect(at(degrees).angleTo(at(degrees + 5))).toBeLessThan(0.2);
    }
  });

  test("a leg held out sideways keeps a whole frame too", () => {
    const hip = average.joints.hip.L;
    const split: Joints = {
      ...average.joints,
      knee: { ...average.joints.knee, L: hip.clone().add(new Vector3(0.4, 0, 0)) },
    };
    const thigh = frameOf(split, "thighL");
    expect(thigh.left.length()).toBeCloseTo(1, 9);
    expect(Math.abs(thigh.left.dot(thigh.axis))).toBeLessThan(1e-9);
  });
});

describe("segmentsFromSkin", () => {
  test("tells the segments apart by distance alone, as for an atlas", () => {
    const { points } = skinOf(average);
    const found = segmentsFromSkin(points, average.joints);
    const known = segmentsOf(average);
    expect(found).not.toBeNull();
    for (const id of [
      "abdomen",
      "chest",
      "thighL",
      "shinR",
      "upperArmL",
      "forearmR",
    ] as const) {
      expect(found![id].halfWidth).toBeCloseTo(known[id].halfWidth, 2);
      // The top of a thigh is shared with the pelvis, so its centre is looser.
      expect(found![id].origin.distanceTo(known[id].origin)).toBeLessThan(0.04);
    }
  });

  test("labels a point on a limb to that limb", () => {
    const segments = segmentsOf(average);
    const knee = average.joints.knee.L;
    const midShin = knee.clone().lerp(average.joints.ankle.L, 0.5);
    const [label] = labelPoints(Float32Array.from(midShin.toArray()), segments);
    expect(SEGMENT_IDS[label!]).toBe("shinL");
  });
});

describe("fitMatrices", () => {
  const atlas = segmentsOf(average);
  const at = (segments: Segments, body: Segments, id: (typeof SEGMENT_IDS)[number]) =>
    fitMatrices(segments, body).matrices[SEGMENT_IDS.indexOf(id)]!;

  test("lays each segment on the body's: joints, tips and crown land on theirs", () => {
    for (const move of [new Matrix4(), SCAN]) {
      const body = segmentsOf(heavy, move);
      const lands = (id: (typeof SEGMENT_IDS)[number], from: Vector3, to: Vector3) =>
        from
          .clone()
          .applyMatrix4(at(atlas, body, id))
          .distanceTo(to.clone().applyMatrix4(move));
      expect(fitMatrices(atlas, body).ok).toBe(true);
      expect(lands("thighL", average.joints.hip.L, heavy.joints.hip.L)).toBeLessThan(
        0.01,
      );
      expect(lands("thighL", average.joints.knee.L, heavy.joints.knee.L)).toBeLessThan(
        0.01,
      );
      expect(lands("shinR", average.joints.ankle.R, heavy.joints.ankle.R)).toBeLessThan(
        0.01,
      );
      expect(
        lands("forearmL", average.joints.wrist.L, heavy.joints.wrist.L),
      ).toBeLessThan(0.01);
      expect(lands("footR", average.toe.R, heavy.toe.R)).toBeLessThan(0.01);
      expect(lands("handL", average.finger.L, heavy.finger.L)).toBeLessThan(0.01);
      const crown = (shape: typeof AVERAGE_FIGURE) =>
        new Vector3(0, shape.trunk + shape.head.top, 0);
      expect(lands("head", crown(AVERAGE_FIGURE), crown(HEAVY_FIGURE))).toBeLessThan(
        0.01,
      );
    }
  });

  test("scales the skin onto the skin: the belly's front, a thigh's side", () => {
    const body = segmentsOf(heavy);
    const mid = (shape: typeof AVERAGE_FIGURE): number => 0.3 * shape.trunk;
    const belly = new Vector3(
      0,
      mid(AVERAGE_FIGURE),
      AVERAGE_FIGURE.abdomen[1],
    ).applyMatrix4(at(atlas, body, "abdomen"));
    expect(belly.z).toBeCloseTo(HEAVY_FIGURE.belly + HEAVY_FIGURE.abdomen[1], 2);
    const thigh = (figure: Figure) =>
      figure.joints.hip.L.clone().lerp(figure.joints.knee.L, 0.8);
    const side = thigh(average)
      .add(new Vector3(0, 0, AVERAGE_FIGURE.radius.thigh))
      .applyMatrix4(at(atlas, body, "thighL"));
    expect(side.distanceTo(thigh(heavy))).toBeCloseTo(HEAVY_FIGURE.radius.thigh, 2);
  });

  test("keeps a figure where it is when fitted to itself", () => {
    const probe = new Vector3(0.1, 0.2, 0.05);
    for (const matrix of fitMatrices(atlas, atlas).matrices) {
      expect(probe.clone().applyMatrix4(matrix).distanceTo(probe)).toBeLessThan(1e-9);
    }
  });

  test("scales bones evenly: a femur and a humerus as much across as along", () => {
    const body = segmentsOf(heavy);
    const { bones } = fitMatrices(atlas, body);
    const across = (id: "thighL" | "upperArmR", from: Vector3, to: Vector3) => {
      const shaft = from.clone().lerp(to, 0.5);
      const side = atlas[id].left.clone().multiplyScalar(0.012);
      const matrix = bones[SEGMENT_IDS.indexOf(id)]!;
      const ends = [shaft.clone().add(side), shaft.clone().sub(side)].map((point) =>
        point.applyMatrix4(matrix),
      );
      return ends[0]!.distanceTo(ends[1]!) / 0.024;
    };
    const { hip, knee, shoulder, elbow } = average.joints;
    const thigh = HEAVY_FIGURE.thigh / AVERAGE_FIGURE.thigh;
    const upperArm = HEAVY_FIGURE.upperArm / AVERAGE_FIGURE.upperArm;
    expect(Math.abs(across("thighL", hip.L, knee.L) / thigh - 1)).toBeLessThan(0.02);
    expect(
      Math.abs(across("upperArmR", shoulder.R, elbow.R) / upperArm - 1),
    ).toBeLessThan(0.02);
    // The shaft's middle stays on the body's centre line, as the soft map puts it.
    const mid = hip.L.clone().lerp(knee.L, 0.5);
    const thighIndex = SEGMENT_IDS.indexOf("thighL");
    expect(
      mid
        .clone()
        .applyMatrix4(bones[thighIndex]!)
        .distanceTo(
          mid.clone().applyMatrix4(fitMatrices(atlas, body).matrices[thighIndex]!),
        ),
    ).toBeLessThan(1e-6);
  });

  test("a figure much shorter or taller than the atlas falls back", () => {
    const scaled = (height: number): Segments => {
      // The average figure is 1.742 m from crown to toe.
      const k = height / 1.742;
      const { radius, head } = AVERAGE_FIGURE;
      const times = ([a, b]: readonly [number, number]) => [k * a, k * b] as const;
      return segmentsOf(
        syntheticFigure({
          ...AVERAGE_FIGURE,
          ...Object.fromEntries(
            (
              [
                "trunk",
                "hipSpan",
                "shoulderSpan",
                "thigh",
                "shin",
                "foot",
                "upperArm",
                "forearm",
                "hand",
                "belly",
              ] as const
            ).map((key) => [key, k * AVERAGE_FIGURE[key]]),
          ),
          radius: {
            thigh: k * radius.thigh,
            shin: k * radius.shin,
            upperArm: k * radius.upperArm,
            forearm: k * radius.forearm,
          },
          pelvis: times(AVERAGE_FIGURE.pelvis),
          abdomen: times(AVERAGE_FIGURE.abdomen),
          chest: times(AVERAGE_FIGURE.chest),
          neck: times(AVERAGE_FIGURE.neck),
          head: {
            halfWidth: k * head.halfWidth,
            halfDepth: k * head.halfDepth,
            top: k * head.top,
          },
        }),
      );
    };
    // An even figure scales every segment by its height ratio, so it falls
    // back just outside the band: 0.75 × 1.742 = 1.31 m, 1.35 × 1.742 = 2.35 m.
    expect(FIT_ALONG_BAND).toEqual([0.75, 1.35]);
    expect(fitMatrices(atlas, scaled(1.3)).ok).toBe(false);
    expect(fitMatrices(atlas, scaled(2.4)).ok).toBe(false);
    expect(fitMatrices(atlas, scaled(1.4)).ok).toBe(true);
    expect(fitMatrices(atlas, scaled(2.2)).ok).toBe(true);
  });

  test("refuses a segment scaled out of all proportion, unless it holds no anatomy", () => {
    const body = segmentsOf(heavy);
    const giant = { ...body, shinL: { ...body.shinL, length: 3 * body.shinL.length } };
    expect(fitMatrices(atlas, giant).ok).toBe(false);
    const shin = SEGMENT_IDS.indexOf("shinL");
    expect(fitMatrices(atlas, giant, (index) => index !== shin).ok).toBe(true);
  });
});

describe("skinWeights", () => {
  const segments = segmentsOf(average);
  const weigh = (point: Vector3) => {
    const { index, weight } = skinWeights(Float32Array.from(point.toArray()), segments);
    return { first: SEGMENT_IDS[index[0]!], second: SEGMENT_IDS[index[1]!], weight };
  };

  test("a point on a bone line follows that segment alone", () => {
    const midThigh = average.joints.hip.R.clone().lerp(average.joints.knee.R, 0.5);
    const { first, weight } = weigh(midThigh);
    expect(first).toBe("thighR");
    expect([...weight]).toEqual([255, 0, 0, 0]);
  });

  test("a point at a joint follows both halves, and the bytes sum to 255", () => {
    const { first, second, weight } = weigh(average.joints.knee.L);
    expect([first, second].sort()).toEqual(["shinL", "thighL"]);
    expect(weight[0]! + weight[1]!).toBe(255);
    expect(Math.abs(weight[0]! - weight[1]!)).toBeLessThan(40);
  });

  test("an organ in the trunk follows the trunk, not the arm beside it", () => {
    const liver = new Vector3(-0.08, 0.35 * AVERAGE_FIGURE.trunk, 0.03);
    expect(weigh(liver).first).toBe("abdomen");
  });
});

describe("boneWeights", () => {
  const segments = segmentsOf(average);
  /** A small closed box of 8 corners and 12 triangles round `centre`, indexed from `first`. */
  const box = (centre: Vector3, half: Vector3, first: number) => {
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((n) =>
      centre
        .clone()
        .add(
          new Vector3(
            (n & 1 ? 1 : -1) * half.x,
            (n & 2 ? 1 : -1) * half.y,
            (n & 4 ? 1 : -1) * half.z,
          ),
        ),
    );
    const faces = [
      [0, 1, 3],
      [0, 3, 2],
      [4, 6, 7],
      [4, 7, 5],
      [0, 4, 5],
      [0, 5, 1],
      [2, 3, 7],
      [2, 7, 6],
      [0, 2, 6],
      [0, 6, 4],
      [1, 5, 7],
      [1, 7, 3],
    ].flat();
    return { corners, faces: faces.map((corner) => first + corner) };
  };
  const { wrist, ankle, elbow, hip, knee } = average.joints;
  const pieces = [
    // A carpal and a tarsal straddling their joints, a femur from hip to knee.
    box(wrist.L.clone().lerp(elbow.L, -0.04), new Vector3(0.012, 0.012, 0.01), 0),
    box(
      ankle.R.clone().add(new Vector3(0, -0.01, 0.01)),
      new Vector3(0.015, 0.02, 0.02),
      8,
    ),
    box(hip.L.clone().lerp(knee.L, 0.5), new Vector3(0.015, 0.22, 0.015), 16),
  ];
  const points = Float32Array.from(
    pieces.flatMap((piece) => piece.corners.flatMap((corner) => corner.toArray())),
  );
  const faces = pieces.flatMap((piece) => piece.faces);
  const segmentsOfPiece = (index: Uint8Array, piece: number): readonly string[] => [
    ...new Set(
      Array.from(
        { length: 8 },
        (_, corner) => SEGMENT_IDS[index[4 * (8 * piece + corner)]!]!,
      ),
    ),
  ];

  test("every vertex of a carpal, a tarsal and a femur follows one segment, at 255", () => {
    const { index, weight } = boneWeights(points, segments, faces);
    // Which one a bone at a joint follows is the vote of its vertices; that it is one is the point.
    expect(segmentsOfPiece(index, 0).length).toBe(1);
    expect(segmentsOfPiece(index, 1).length).toBe(1);
    expect(segmentsOfPiece(index, 2)).toEqual(["thighL"]);
    for (let i = 0; i < points.length / 3; i += 1) {
      expect([...weight.slice(4 * i, 4 * i + 4)]).toEqual([255, 0, 0, 0]);
    }
  });

  test("blended weights would have split those pieces between segments", () => {
    const { index, weight } = skinWeights(points, segments);
    expect(
      segmentsOfPiece(index, 0).length + segmentsOfPiece(index, 1).length,
    ).toBeGreaterThan(2);
    expect([...weight].some((value) => value !== 0 && value !== 255)).toBe(true);
  });

  test("an unindexed mesh is joined where its triangles share a corner", () => {
    const corners = faces.flatMap((corner) => [
      points[3 * corner]!,
      points[3 * corner + 1]!,
      points[3 * corner + 2]!,
    ]);
    const { index } = boneWeights(Float32Array.from(corners), segments, null);
    const pieceOf = (piece: number): readonly string[] => [
      ...new Set(
        Array.from({ length: 36 }, (_, i) => SEGMENT_IDS[index[4 * (36 * piece + i)]!]!),
      ),
    ];
    expect(pieceOf(0)).toEqual(
      segmentsOfPiece(boneWeights(points, segments, faces).index, 0),
    );
    expect(pieceOf(1)).toEqual(
      segmentsOfPiece(boneWeights(points, segments, faces).index, 1),
    );
    expect(pieceOf(2)).toEqual(["thighL"]);
  });
});
