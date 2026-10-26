import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createGuidelineTools } from "./ai-tools";

const streamSource = readFileSync(
  join(import.meta.dir, "../../features/chat/stream-model-response.ts"),
  "utf8",
);
const chatToolsSource = readFileSync(
  join(import.meta.dir, "../../features/chat/chat-tools.ts"),
  "utf8",
);
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

  test("stream-model-response merges guideline tools without wearable summaries", () => {
    expect(streamSource).toMatch(/createChatTools\(\s*\{/);
    expect(streamSource).not.toMatch(
      /createChatTools\([^)]*(oura|whoop|googleHealth|vitronic)/i,
    );
    expect(chatToolsSource).toContain("createGuidelineTools(scope)");
    expect(turnSource).toContain("drainGuidelineTurn(turnId)");
    expect(chatToolsSource).not.toMatch(/createGuidelineTools\([^)]*oura/);
    expect(chatToolsSource).not.toMatch(/createGuidelineTools\([^)]*whoop/);
    expect(chatToolsSource).not.toMatch(/createGuidelineTools\([^)]*googleHealth/);
    // The turn's snapshots reach show_view only, which reads them on this server.
    expect(chatToolsSource).toContain("wearables: options?.wearables ?? NO_WEARABLES,");
    expect(chatToolsSource.match(/options\?\.wearables/g)).toEqual([
      "options?.wearables",
    ]);
  });
});
