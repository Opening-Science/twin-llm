import { describe, expect, test } from "bun:test";

import {
  jointTable,
  missedTargets,
  parseFitReport,
  stretchSummary,
  type FitReport,
} from "./fit-report";

const sha = "a".repeat(64);

const row = (joint: string, before: number, after: number) => ({
  joint,
  body: [0.1, 0, 0.5],
  before: [0.1, 0, 0.5 - before],
  after: [0.1, 0, 0.5 - after],
  beforeOutwardM: -0.01,
  beforeVerticalM: -before,
  beforeDistanceM: before,
  afterOutwardM: 0.001,
  afterVerticalM: -after,
  afterDistanceM: after,
});

const report = {
  atlas: "hra.ao.glb",
  atlasSha256: sha,
  body: "anny-adult-f.rigged.glb",
  bodySha256: sha,
  output: "anny-adult-f.hra-f.fitted.glb",
  outputSha256: sha,
  outputBytes: 23_530_756,
  triangles: 4_020_278,
  blender: "5.2.3 LTS",
  scale: 1.0687,
  stretchLimbs: true,
  trunkShiftM: [0, 0.0312, 0],
  stretch: { "thigh.L": 0.8342, "shin.L": 1.1955, "thigh.R": 0.8334, "shin.R": 1.1952 },
  hasArms: false,
  notes: [
    "No humerus, radius and ulna on both sides: the arms are not fitted and move with the trunk.",
  ],
  joints: [
    row("knee.L", 0.075, 0.002),
    row("knee.R", 0.074, 0.025),
    row("hip.L", 0.075, 0.069),
  ],
  seconds: 14,
  vertices: { bone: 1 },
};

describe("parseFitReport", () => {
  test("accepts a report and drops fields it does not know", () => {
    const parsed = parseFitReport(JSON.stringify(report));
    expect(parsed?.stretch["shin.L"]).toBe(1.1955);
    expect(parsed && "vertices" in parsed).toBe(false);
  });

  test("refuses broken JSON and a report missing its joints", () => {
    expect(parseFitReport("{")).toBeNull();
    const { joints: _joints, ...rest } = report;
    expect(parseFitReport(JSON.stringify(rest))).toBeNull();
  });
});

const parsed = parseFitReport(JSON.stringify(report)) as FitReport;

test("missedTargets lists knees and ankles beyond 2 cm only", () => {
  expect(missedTargets(parsed).map((r) => r.joint)).toEqual(["knee.R"]);
  expect(missedTargets(parsed, 0.03)).toEqual([]);
});

test("jointTable writes centimetres, left / right, in joint order", () => {
  expect(
    jointTable([{ body: "ANNY adult (female)", atlas: "hra-f", report: parsed }]),
  ).toBe(
    [
      "| Body | Atlas | Joint | Distance before (L / R) | Out, up before | Distance after | Out, up after |",
      "| ---- | ----- | ----- | ----------------------- | -------------- | -------------- | ------------- |",
      "| ANNY adult (female) | hra-f | hip | 7.5 / — | -1.0 / —, -7.5 / — | 6.9 / — | 0.1 / —, -6.9 / — |",
      "| ANNY adult (female) | hra-f | knee | 7.5 / 7.4 | -1.0 / -1.0, -7.5 / -7.4 | 0.2 / 2.5 | 0.1 / 0.1, -0.2 / -2.5 |",
    ].join("\n"),
  );
});

test("stretchSummary reads the left side as signed percentages", () => {
  expect(stretchSummary(parsed)).toBe("thigh −16.6 %, shin +19.6 %");
});
