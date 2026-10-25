import { describe, expect, test } from "bun:test";

import { costCopy } from "./cost-copy";

describe("costCopy", () => {
  test("local and free-tier calls are free, per model", () => {
    expect(costCopy("ollama")).toEqual({
      sentence: "All listed calls are free.",
      perModel: true,
    });
    expect(costCopy("openrouter")).toEqual({
      sentence: "All listed calls are free.",
      perModel: true,
    });
  });

  test("an hourly pod is not called free", () => {
    expect(costCopy("remote-gpu")).toEqual({
      sentence:
        "Calls carry no charge of their own, but the GPU pod is billed by the hour while it runs.",
      perModel: false,
    });
  });

  test("the Exoscale instance is not called free either", () => {
    expect(costCopy("exoscale")).toEqual({
      sentence:
        "Calls carry no charge of their own, but the Exoscale GPU instance is billed by the hour while it runs.",
      perModel: false,
    });
  });

  test("Infomaniak gets no cost claim", () => {
    expect(costCopy("infomaniak")).toBeNull();
  });
});
