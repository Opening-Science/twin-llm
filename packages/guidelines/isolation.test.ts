import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createGuidelineTools } from "./ai-tools";

/** The turn the route and the eval harness share; it drains the collectors. */
const turnSource = readFileSync(
  join(import.meta.dir, "../../features/chat/run-twin-turn.ts"),
  "utf8",
);

describe("guideline tool isolation", () => {
  test("createGuidelineTools returns guideline_search in both DATA_MODE values", () => {
    const synthetic = createGuidelineTools({
      actor: "a",
      sessionId: "s-syn",
      mode: "synthetic",
    });
    const personal = createGuidelineTools({
      actor: "a",
      sessionId: "s-per",
      mode: "personal",
    });
    expect(Object.keys(synthetic)).toEqual(["guideline_search"]);
    expect(Object.keys(personal)).toEqual(["guideline_search"]);
  });

  // Which factory gets the turn's wearable snapshots is checked by spying on
  // the factories in features/chat/chat-tools-wearables.test.ts.
  test("the shared turn drains the guideline collector", () => {
    expect(turnSource).toContain("drainGuidelineTurn(turnId)");
  });
});
