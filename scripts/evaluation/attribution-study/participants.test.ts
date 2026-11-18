import { describe, expect, test } from "bun:test";

import {
  applyExclusions,
  indicesOf,
  type Participant,
  partB,
  partBMarkdown,
  simulateParticipants,
  SIMULATION_DEFAULTS,
  simulatedPower,
  type TrialResponse,
} from "./participants";
import { runPartB } from "./participants-run";

const response = (overrides: Partial<TrialResponse>): TrialResponse => ({
  trialId: "t",
  kind: "detection",
  truth: "correct",
  evidence: "validated",
  flagged: false,
  trust: 4,
  panelOpened: false,
  ...overrides,
});

const participant = (overrides: Partial<Participant> = {}): Participant => ({
  id: "p1",
  panelId: "panel-1",
  arm: "D1",
  seconds: 900,
  attentionPassed: [true, true],
  responses: [
    response({ truth: "wrong_source", flagged: true }),
    response({ truth: "correct", flagged: false }),
  ],
  ...overrides,
});

describe("applyExclusions", () => {
  test("each registered reason, in order; the first panel id is kept", () => {
    const result = applyExclusions(
      [
        participant({ id: "ok" }),
        participant({ id: "attention", panelId: "a", attentionPassed: [true, false] }),
        participant({ id: "fast", panelId: "b", seconds: 200 }),
        participant({
          id: "same",
          panelId: "c",
          responses: [
            response({ truth: "wrong_day", flagged: true }),
            response({ truth: "correct", flagged: true }),
          ],
        }),
        participant({ id: "again" }),
      ],
      900,
    );
    expect(result.kept.map((p) => p.id)).toEqual(["ok"]);
    expect(result.excluded).toEqual([
      { id: "attention", reason: "attention" },
      { id: "fast", reason: "too_fast" },
      { id: "same", reason: "same_answer" },
      { id: "again", reason: "duplicate_panel_id" },
    ]);
  });
});

describe("indicesOf", () => {
  test("perfect detection gives a positive d′ and the trust gap over correct answers", () => {
    const indices = indicesOf(
      participant({
        responses: [
          response({ truth: "wrong_source", flagged: true, trust: 1 }),
          response({ truth: "correct", flagged: false, evidence: "validated", trust: 6 }),
          response({
            kind: "calibration",
            truth: "correct",
            flagged: null,
            evidence: "none",
            trust: 3,
            panelOpened: true,
          }),
        ],
      }),
    );
    expect(indices.dPrime).toBeGreaterThan(0);
    expect(indices.calibrationGap).toBe(3);
    expect(indices.panelUse).toBeCloseTo(1 / 3, 10);
  });

  test("no correct answer on one side leaves the gap empty", () => {
    expect(indicesOf(participant()).calibrationGap).toBeNull();
  });
});

describe("partB on simulated participants", () => {
  const simulated = simulateParticipants(7);
  const result = partB(simulated, 900);

  test("seeded, with the careless share excluded", () => {
    expect(simulateParticipants(7)).toEqual(simulated);
    expect(simulated).toHaveLength(3 * SIMULATION_DEFAULTS.perArm);
    expect(result.exclusions.excluded.length).toBeGreaterThan(0);
    expect(result.perArm.D0 + result.perArm.D1 + result.perArm.D2).toBe(
      result.exclusions.kept.length,
    );
  });

  test("the simulated effects are found and supported", () => {
    expect(result.u1?.difference).toBeGreaterThan(0);
    expect(result.u2?.difference).toBeGreaterThan(0);
    expect(result.holm.U1?.reject).toBe(true);
    expect(result.holm.U2?.reject).toBe(true);
    expect(partBMarkdown(result, "Simulated.")).toContain("(supported)");
  });

  test("with no effect nothing is supported at this seed", () => {
    const flat = simulateParticipants(7, {
      ...SIMULATION_DEFAULTS,
      dPrime: { D0: 1, D1: 1, D2: 1 },
      gap: { D0: 0.5, D1: 0.5, D2: 0.5 },
    });
    const none = partB(flat, 900);
    expect(none.holm.U1?.reject).toBe(false);
    expect(none.holm.U2?.reject).toBe(false);
  });
});

describe("runPartB", () => {
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };

  test("a simulated run writes the page and says it is simulated", async () => {
    const written = new Map<string, string>();
    const code = await runPartB(
      ["--simulate", "--out", "out"],
      io,
      () => Promise.reject(new Error("no file is read")),
      async (path, text) => {
        written.set(path, text);
      },
    );
    expect(code).toBe(0);
    expect(written.get("out/partb.md")).toContain("Simulated participants");
  });

  test("a responses file is read and analysed", async () => {
    const written = new Map<string, string>();
    const code = await runPartB(
      ["--responses", "r.json", "--pilot-median", "900", "--out", "out"],
      io,
      () => Promise.resolve(JSON.stringify(simulateParticipants(3))),
      async (path, text) => {
        written.set(path, text);
      },
    );
    expect(code).toBe(0);
    expect(written.get("out/partb.md")).toContain("| U1 |");
  });

  test("without --simulate both flags are required", async () => {
    expect(
      await runPartB(
        [],
        io,
        () => Promise.resolve(""),
        async () => {},
      ),
    ).toBe(1);
  });

  test("--power adds the share of simulated studies that support each contrast", async () => {
    const written = new Map<string, string>();
    await runPartB(
      ["--simulate", "--power", "20", "--out", "out"],
      io,
      () => Promise.reject(new Error("no file is read")),
      async (path, text) => {
        written.set(path, text);
      },
    );
    expect(written.get("out/partb.md")).toMatch(
      /Over 20 simulated studies at the effects above: U1 supported in \d+%, U2 in \d+%\./,
    );
  });
});

describe("simulatedPower", () => {
  test("high at the simulated effects, low with none", () => {
    expect(simulatedPower(11, 30).u2).toBeGreaterThan(0.8);
    const flat = simulatedPower(11, 30, {
      ...SIMULATION_DEFAULTS,
      dPrime: { D0: 1, D1: 1, D2: 1 },
      gap: { D0: 0.5, D1: 0.5, D2: 0.5 },
    });
    expect(flat.u1).toBeLessThan(0.2);
    expect(flat.u2).toBeLessThan(0.2);
  });
});
