import { describe, expect, test } from "bun:test";

import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { createEstimateLedger, recordEstimates } from "./estimate-ledger";

const ROW = {
  location: "Nigeria",
  value: 5,
  lower: 4,
  upper: 6,
  unit: "per 100,000",
  measure: "prevalence",
  extra: "ignored",
};

const options = (toolCallId: string): ToolExecutionOptions => ({
  toolCallId,
  messages: [],
});

describe("createEstimateLedger", () => {
  test("keeps outputs that are estimate rows, in order, without unknown fields", () => {
    const ledger = createEstimateLedger();
    ledger.record("gbd_population", "c1", [ROW]);
    ledger.record("gbd_population", "c2", []);
    ledger.record("gbd_population", "c3", { error: "gbd-not-recorded" });
    ledger.record("gbd_population", "c4", [{ ...ROW, value: "5" }]);
    expect(ledger.recorded()).toEqual([
      {
        tool: "gbd_population",
        callId: "c1",
        rows: [
          {
            location: "Nigeria",
            value: 5,
            lower: 4,
            upper: 6,
            unit: "per 100,000",
            measure: "prevalence",
          },
        ],
      },
    ]);
  });

  test("keeps a gbd_estimate result as its rows", () => {
    const ledger = createEstimateLedger();
    ledger.record("gbd_estimate", "c1", {
      source: "IHME GBD 2023",
      measure: "deaths",
      metric: "rate",
      unit: "per 100,000",
      sex: "both",
      age: "all_ages",
      cause: "Cardiovascular diseases",
      risk: null,
      rows: [
        {
          location: "Alabama",
          location_id: 523,
          iso3: "USA",
          iso3166_2: "US-AL",
          year: 2021,
          value: 220,
          lower: 200,
          upper: 240,
        },
      ],
    });
    const [entry] = ledger.recorded();
    expect(entry?.tool).toBe("gbd_estimate");
    expect(entry?.rows[0]).toMatchObject({
      location: "Alabama",
      iso3166_2: "US-AL",
      level: "subnational",
      value: 220,
      year: "2021",
    });
  });

  test("hands out a copy", () => {
    const ledger = createEstimateLedger();
    const first = ledger.recorded();
    ledger.record("t", "c", [ROW]);
    expect(first).toEqual([]);
  });
});

describe("recordEstimates", () => {
  test("records each call's output by call id and returns it unchanged", async () => {
    const ledger = createEstimateLedger();
    const tools = recordEstimates(
      {
        lookup: tool({
          description: "made-up estimates",
          inputSchema: z.object({ value: z.number() }),
          execute: async ({ value }) => [{ ...ROW, value }],
        }),
      },
      ledger,
    );
    const output = await tools.lookup.execute?.({ value: 7 }, options("call-7"));
    expect(output).toEqual([{ ...ROW, value: 7 }]);
    expect(
      ledger.recorded().map((entry) => [entry.tool, entry.callId, entry.rows[0].value]),
    ).toEqual([["lookup", "call-7", 7]]);
  });

  test("leaves a tool without execute as it is", () => {
    const ledger = createEstimateLedger();
    const plain = tool({ description: "client side", inputSchema: z.object({}) });
    expect(recordEstimates({ plain }, ledger).plain).toBe(plain);
  });
});
