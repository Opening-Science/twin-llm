import { describe, expect, test } from "bun:test";

import type { OuraSummary } from "@/infrastructure/oura-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";

import { loadWearableContext, type WearableLoaders } from "./wearable-context";

const window = { startDate: "2026-07-10", endDate: "2026-07-10" };
const oura: OuraSummary = { window, metrics: [], narrative: "Synthetic Oura window." };
const whoop: WhoopSummary = { window, metrics: [], narrative: "Synthetic Whoop window." };

const recordingLoaders = () => {
  const calls: string[] = [];
  const loaders: WearableLoaders = {
    oura: async (id) => {
      calls.push(`oura:${id}`);
      return oura;
    },
    whoop: async (id) => {
      calls.push(`whoop:${id}`);
      return whoop;
    },
    googleHealth: async (id) => {
      calls.push(`googleHealth:${id}`);
      return null;
    },
    vitronic: async (id) => {
      calls.push(`vitronic:${id}`);
      return null;
    },
  };
  return { calls, loaders };
};

describe("loadWearableContext", () => {
  test("synthetic mode reads no wearable snapshot and returns four nulls", async () => {
    const { calls, loaders } = recordingLoaders();
    const context = await loadWearableContext("synthetic", "user-1", loaders);
    expect(context).toEqual({
      ouraSummary: null,
      whoopSummary: null,
      googleHealthSummary: null,
      vitronicSummary: null,
    });
    expect(calls).toEqual([]);
  });

  test("personal mode calls each loader once with the user id and passes values through", async () => {
    const { calls, loaders } = recordingLoaders();
    const context = await loadWearableContext("personal", "user-1", loaders);
    expect(context).toEqual({
      ouraSummary: oura,
      whoopSummary: whoop,
      googleHealthSummary: null,
      vitronicSummary: null,
    });
    expect(calls).toEqual([
      "oura:user-1",
      "whoop:user-1",
      "googleHealth:user-1",
      "vitronic:user-1",
    ]);
  });
});
