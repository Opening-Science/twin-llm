import { describe, expect, test } from "bun:test";

import { guidelineDetail, guidelineStatusFromCounts } from "./guideline-status-view";
import { getGuidelineCorpusStatus } from "./guidelines-status";

describe("guidelineStatusFromCounts", () => {
  test("adds up the catalogue and the full-text rows", () => {
    const status = guidelineStatusFromCounts([
      { ingestMode: "full_text", count: 6 },
      { ingestMode: "cite_only", count: 4 },
    ]);
    expect(status).toEqual({ state: "ok", guidelines: 10, fullText: 6 });
    expect(guidelineDetail(status)).toBe("10 guidelines indexed · 6 full text");
  });

  test("an empty index is empty, and has no detail", () => {
    expect(guidelineStatusFromCounts([])).toEqual({ state: "empty" });
    expect(guidelineDetail({ state: "empty" })).toBeNull();
  });

  test("one guideline reads in the singular", () => {
    expect(guidelineDetail({ state: "ok", guidelines: 1, fullText: 0 })).toBe(
      "1 guideline indexed · 0 full text",
    );
  });
});

describe("getGuidelineCorpusStatus", () => {
  test("a failing read is an error and logs the error name only", async () => {
    const logged: Array<readonly [string, string]> = [];
    const status = await getGuidelineCorpusStatus({
      countByIngestMode: async () => {
        throw new TypeError("synthetic connection string in message");
      },
      logError: (message, name) => {
        logged.push([message, name]);
      },
    });
    expect(status).toEqual({ state: "error" });
    expect(logged).toEqual([["[connectors] guideline status failed", "TypeError"]]);
  });
});
