/**
 * The report `fit_atlas.py` writes per body and atlas, checked with zod, and
 * the joint table made from it (console and docs/anatomy.md). Pure.
 *
 * Distances are metres in the report and centimetres in the table. "Out" is
 * side to side, positive when the atlas joint stands outside the body's;
 * "up" is vertical, positive when it stands higher. The ends (feet and
 * hands) also get angles to the body's, in degrees, and the share of their
 * bones inside the body's skin.
 */
import { z } from "zod";

import { formatNumber } from "../../infrastructure/format-measure";

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const jointRow = z.object({
  joint: z.string(),
  body: vec3,
  before: vec3,
  after: vec3,
  beforeOutwardM: z.number(),
  beforeVerticalM: z.number(),
  beforeDistanceM: z.number(),
  afterOutwardM: z.number(),
  afterVerticalM: z.number(),
  afterDistanceM: z.number(),
});

const orientationRow = z.object({
  part: z.string(),
  measure: z.enum(["pointing", "palm"]),
  beforeDeg: z.number(),
  afterDeg: z.number(),
});

const insideRow = z.object({
  part: z.string(),
  beforeShare: z.number().min(0).max(1),
  afterShare: z.number().min(0).max(1),
});

export const fitReportSchema = z.object({
  atlas: z.string(),
  atlasSha256: z.string().regex(/^[0-9a-f]{64}$/),
  body: z.string(),
  bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
  output: z.string(),
  outputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  outputBytes: z.number().int().positive(),
  triangles: z.number().int().positive(),
  blender: z.string(),
  scale: z.number().positive(),
  stretchLimbs: z.boolean(),
  trunkShiftM: vec3,
  stretch: z.record(z.string(), z.number()),
  hasArms: z.boolean(),
  notes: z.array(z.string()),
  joints: z.array(jointRow),
  // Reports written before the ends were turned have none of these.
  endTurnsDeg: z.record(z.string(), z.number()).default({}),
  orientation: z.array(orientationRow).default([]),
  bonesInsideSkin: z.array(insideRow).default([]),
  seconds: z.number(),
});

export type FitReport = z.infer<typeof fitReportSchema>;
export type JointRow = z.infer<typeof jointRow>;
export type OrientationRow = z.infer<typeof orientationRow>;
export type InsideRow = z.infer<typeof insideRow>;

/** The joints whose miss the fit is judged by: knees and ankles. */
export const TARGET_JOINTS = ["knee", "ankle"] as const;
export const TARGET_DISTANCE_M = 0.02;

export const parseFitReport = (text: string): FitReport | null => {
  try {
    const parsed = fitReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Knee and ankle rows further than the target from the body's joint after the fit. */
export const missedTargets = (
  report: FitReport,
  limit: number = TARGET_DISTANCE_M,
): readonly JointRow[] =>
  report.joints.filter(
    (row) =>
      (TARGET_JOINTS as readonly string[]).includes(row.joint.split(".")[0] ?? "") &&
      row.afterDistanceM > limit,
  );

const cm = (metres: number): string => formatNumber(metres * 100, 1);

const sides = <Row>(
  rows: readonly Row[],
  name: (row: Row) => string,
  pick: (row: Row) => number,
  show: (value: number) => string,
): string => {
  const left = rows.find((row) => name(row).endsWith(".L"));
  const right = rows.find((row) => name(row).endsWith(".R"));
  return `${left ? show(pick(left)) : "—"} / ${right ? show(pick(right)) : "—"}`;
};

const pair = (rows: readonly JointRow[], pick: (row: JointRow) => number): string =>
  sides(rows, (row) => row.joint, pick, cm);

const JOINT_ORDER = [
  "hip",
  "knee",
  "ankle",
  "toe",
  "shoulder",
  "elbow",
  "wrist",
  "finger",
] as const;

/** Table labels where the joint's report name is not plain English. */
const JOINT_LABEL: Readonly<Partial<Record<(typeof JOINT_ORDER)[number], string>>> = {
  toe: "toe tip",
  finger: "middle fingertip",
};

export type LabelledReport = Readonly<{ body: string; atlas: string; report: FitReport }>;

/**
 * One Markdown row per body, atlas and joint: distance, then side-to-side
 * and vertical miss, before and after, left / right, in centimetres.
 */
export const jointTable = (reports: readonly LabelledReport[]): string => {
  const header = [
    "| Body | Atlas | Joint | Distance before (L / R) | Out, up before | Distance after | Out, up after |",
    "| ---- | ----- | ----- | ----------------------- | -------------- | -------------- | ------------- |",
  ];
  const rows = reports.flatMap(({ body, atlas, report }) =>
    JOINT_ORDER.flatMap((name) => {
      const rows = report.joints.filter((row) => row.joint.split(".")[0] === name);
      if (rows.length === 0) return [];
      return [
        `| ${body} | ${atlas} | ${JOINT_LABEL[name] ?? name} | ${pair(rows, (r) => r.beforeDistanceM)} | ${pair(rows, (r) => r.beforeOutwardM)}, ${pair(rows, (r) => r.beforeVerticalM)} | ${pair(rows, (r) => r.afterDistanceM)} | ${pair(rows, (r) => r.afterOutwardM)}, ${pair(rows, (r) => r.afterVerticalM)} |`,
      ];
    }),
  );
  return [...header, ...rows].join("\n");
};

/** Segment stretch as percentages, e.g. "thigh −9.6 %, shin +12.7 %" (left side). */
export const stretchSummary = (report: FitReport): string =>
  Object.entries(report.stretch)
    .filter(([segment]) => segment.endsWith(".L"))
    .map(([segment, factor]) => {
      const percent = (factor - 1) * 100;
      const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
      return `${segment.replace(/\.L$/, "")} ${sign}${formatNumber(Math.abs(percent), 1)} %`;
    })
    .join(", ");

const END_ROWS = [
  ["foot", "pointing", "foot points"],
  ["hand", "pointing", "hand points"],
  ["hand", "palm", "palm faces"],
] as const;

/**
 * The feet and hands against the body's: the angle between where each
 * points (a foot seen from above) and which way the palm faces, in degrees,
 * and the share of its bones inside the body's skin, before and after,
 * left / right. Pairs without foot or hand bones have no rows.
 */
export const endTable = (reports: readonly LabelledReport[]): string => {
  const header = [
    "| Body | Atlas | End | Angle before (L / R) | Angle after | Bones inside skin before | After |",
    "| ---- | ----- | --- | -------------------- | ----------- | ------------------------ | ----- |",
  ];
  const degrees = (value: number): string => `${formatNumber(value, 0)}°`;
  const percent = (value: number): string => `${formatNumber(value * 100, 0)} %`;
  const rows = reports.flatMap(({ body, atlas, report }) =>
    END_ROWS.flatMap(([end, measure, label]) => {
      const angles = report.orientation.filter(
        (row) => row.measure === measure && row.part.split(".")[0] === end,
      );
      if (angles.length === 0) return [];
      const inside = report.bonesInsideSkin.filter(
        (row) => row.part.split(".")[0] === end,
      );
      const share = (pick: (row: InsideRow) => number): string =>
        measure === "palm" || inside.length === 0
          ? ""
          : sides(inside, (row) => row.part, pick, percent);
      const angle = (pick: (row: OrientationRow) => number): string =>
        sides(angles, (row) => row.part, pick, degrees);
      return [
        `| ${body} | ${atlas} | ${label} | ${angle((row) => row.beforeDeg)} | ${angle((row) => row.afterDeg)} | ${share((row) => row.beforeShare)} | ${share((row) => row.afterShare)} |`,
      ];
    }),
  );
  return [...header, ...rows].join("\n");
};
