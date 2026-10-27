import { describe, expect, test } from "bun:test";

import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { AppendInput } from "@/packages/audit/append";

import type { QueryToolPorts } from "./ports";
import type { SessionScope } from "./scope";
import { runCrossSourceCompare } from "./tools";

/**
 * `cross_source_compare` over synthetic snapshots: Oura and Whoop HRV on the
 * same days. The agreement maths is checked by hand in
 * source-agreement.test.ts; this covers the tool's reads and refusals.
 */

const fakePorts = () => {
  const audits: AppendInput[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => null,
    findObservations: async () => [],
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits };
};

const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };
const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };

const day = (n: number): string => `2026-09-${String(n).padStart(2, "0")}`;
const metric = (key: string, n: number, value: number, unit: string) => ({
  key: `${key}.${day(n)}`,
  label: key,
  value,
  date: day(n),
  unit,
});

const OURA = [40, 41, 42, 43, 44, 45, 46, 47];
const WHOOP = [43, 46, 45, 48, 47, 50, 49];

const snapshot = (metrics: ReturnType<typeof metric>[]) => ({
  window: { startDate: day(1), endDate: day(8) },
  metrics,
  narrative: "synthetic",
});

const LINKED: WearableSummaries = {
  oura: snapshot(
    OURA.map((value, i) => metric("sleep.hrv.long_sleep", i + 1, value, "ms")),
  ),
  whoop: snapshot(
    WHOOP.map((value, i) => metric("whoop.recovery.hrv", i + 1, value, "ms")),
  ),
  googleHealth: null,
  vitronic: null,
};

const INPUT = {
  measure: "hrv",
  source_a: "oura",
  source_b: "whoop",
  start: "2026-09-01T00:00:00Z",
  end: "2026-09-08T23:59:59Z",
} as const;

describe("cross_source_compare", () => {
  test("pairs Oura and Whoop HRV by day and reports how far apart they read", async () => {
    const { ports, audits } = fakePorts();
    const result = await runCrossSourceCompare(personal, INPUT, ports, LINKED);
    if ("code" in result) throw new Error(result.code);
    expect(result.n_pairs).toBe(7); // Whoop has no 8 Sept reading.
    expect(result.key_a).toBe("sleep.hrv.long_sleep");
    expect(result.key_b).toBe("whoop.recovery.hrv");
    expect(result.unit).toBe("ms");
    expect(result.mean_difference).toBeCloseTo(27 / 7, 12);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["cross_source_compare", 7],
    ]);
  });

  test("synthetic mode has one series and nothing to compare it with", async () => {
    const { ports } = fakePorts();
    const result = await runCrossSourceCompare(synthetic, INPUT, ports, LINKED);
    expect("code" in result && result.code).toBe("SOURCE_NOT_CONNECTED");
  });

  test("a source that is not linked is refused", async () => {
    const { ports } = fakePorts();
    const result = await runCrossSourceCompare(
      personal,
      { ...INPUT, source_b: "google" },
      ports,
      LINKED,
    );
    expect(result).toMatchObject({ code: "SOURCE_NOT_CONNECTED", source: "google" });
  });

  test("a measure one source does not record is NO_ROWS for that source", async () => {
    const { ports } = fakePorts();
    const result = await runCrossSourceCompare(
      personal,
      { ...INPUT, measure: "resting_hr" },
      ports,
      LINKED,
    );
    expect(result).toMatchObject({ code: "NO_ROWS", source: "oura" });
  });

  test("different units are refused, never converted", async () => {
    const { ports } = fakePorts();
    const seconds: WearableSummaries = {
      ...LINKED,
      whoop: snapshot(
        WHOOP.map((value, i) => metric("whoop.recovery.hrv", i + 1, value, "s")),
      ),
    };
    expect(await runCrossSourceCompare(personal, INPUT, ports, seconds)).toMatchObject({
      code: "UNIT_MISMATCH",
      units: [
        { source: "oura", unit: "ms" },
        { source: "whoop", unit: "s" },
      ],
    });
  });

  test("fewer than 7 shared days is WINDOW_TOO_SHORT", async () => {
    const { ports } = fakePorts();
    const result = await runCrossSourceCompare(
      personal,
      { ...INPUT, end: "2026-09-04T23:59:59Z" },
      ports,
      LINKED,
    );
    expect(result).toMatchObject({
      code: "WINDOW_TOO_SHORT",
      minimum: 7,
      counts: [{ source: "both", n: 4 }],
    });
  });
});
