import { beforeEach, describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AppendInput } from "@/packages/audit/append";

import { drainGbdTurn, resetGbdCollectorForTests } from "./collector";
import { GBD_AUDIT_TOOL } from "./constants";
import { gbdPopulationInput } from "./input";
import { runGbdPopulation } from "./tools";

const fields = gbdPopulationInput.parse({
  measure: "deaths",
  sex: "both",
  age: "all_ages",
  year: "2021",
  location: "Switzerland",
  cause: "Cardiovascular diseases",
});

const scope = {
  actor: "actor-gbd-1",
  sessionId: "turn-gbd-1",
  mode: "personal" as const,
};

describe("gbd population audit", () => {
  beforeEach(() => {
    resetGbdCollectorForTests();
  });

  test("append uses structured args, null subject_ref, and row count", async () => {
    const calls: AppendInput[] = [];
    const rows = await runGbdPopulation(scope, fields, {
      callQuery: async () => [{ value: 12.5, unit: "per 100,000", lower: 10, upper: 15 }],
      append: async (_db, input) => {
        calls.push(input);
        return {
          seq: 1n,
          hash: "h",
          argsSha256: "a".repeat(64),
          resultSha256: "b".repeat(64),
        };
      },
      database: () => ({}) as PrismaClient,
    });

    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe(GBD_AUDIT_TOOL);
    expect(calls[0]?.subjectRef).toBeNull();
    expect(calls[0]?.args).toEqual(fields);
    expect(calls[0]?.args).not.toHaveProperty("question");
    expect(calls[0]?.rowCount).toBe(1);
    expect(JSON.stringify(calls[0]?.args)).not.toContain("IHME GBD population estimate");

    const drained = drainGbdTurn(scope.sessionId);
    expect(drained.rows).toEqual(rows);
    expect(drained.sources).toEqual([{ tool: GBD_AUDIT_TOOL, fields }]);
    expect(drainGbdTurn(scope.sessionId).rows).toEqual([]);
  });

  test("fails closed to empty rows and still audits", async () => {
    const calls: AppendInput[] = [];
    const rows = await runGbdPopulation(scope, fields, {
      callQuery: async () => {
        throw new Error("gbd-http-error");
      },
      append: async (_db, input) => {
        calls.push(input);
        return {
          seq: 2n,
          hash: "h2",
          argsSha256: "c".repeat(64),
          resultSha256: "d".repeat(64),
        };
      },
      database: () => ({}) as PrismaClient,
    });

    expect(rows).toEqual([]);
    expect(calls[0]?.subjectRef).toBeNull();
    expect(calls[0]?.tool).toBe(GBD_AUDIT_TOOL);
    expect(calls[0]?.args).toEqual(fields);
    expect(calls[0]?.rowCount).toBe(0);
    expect(calls[0]?.result).toEqual({ error: "gbd-call-failed" });
  });
});
