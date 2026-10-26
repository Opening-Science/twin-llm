import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createGbdTools, registerChatTools } from "./ai-tools";

/** The turn the route and the eval harness share; it drains the collectors. */
const turnSource = readFileSync(
  join(import.meta.dir, "../../features/chat/run-twin-turn.ts"),
  "utf8",
);

describe("GBD tool isolation", () => {
  test("createGbdTools returns gbd_population in both DATA_MODE values", () => {
    const synthetic = createGbdTools({
      actor: "a",
      sessionId: "s-syn",
      mode: "synthetic",
    });
    const personal = createGbdTools({
      actor: "a",
      sessionId: "s-per",
      mode: "personal",
    });
    expect(Object.keys(synthetic)).toEqual(["gbd_population"]);
    expect(Object.keys(personal)).toEqual(["gbd_population"]);
  });

  test("registerChatTools accepts SessionScope only", () => {
    expect(registerChatTools.length).toBe(1);
    const tools = registerChatTools({
      actor: "a",
      sessionId: "s-reg",
      mode: "synthetic",
    });
    expect(tools).toHaveProperty("gbd_population");
  });

  // Which factory gets the turn's wearable snapshots is checked by spying on
  // the factories in features/chat/chat-tools-wearables.test.ts.
  test("the shared turn drains the GBD and guideline collectors", () => {
    expect(turnSource).toContain("drainGbdTurn(turnId)");
    expect(turnSource).toContain("drainGuidelineTurn(turnId)");
  });
});
