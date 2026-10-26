import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createGbdTools, registerChatTools } from "./ai-tools";

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

  test("stream-model-response merges GBD tools without wearable summaries", () => {
    expect(streamSource).toMatch(/createChatTools\(\s*\{/);
    expect(streamSource).not.toMatch(
      /createChatTools\([^)]*(oura|whoop|googleHealth|vitronic)/i,
    );
    expect(chatToolsSource).toContain("createGbdTools(scope)");
    expect(chatToolsSource).toContain("createQueryTools(scope, options?.query)");
    expect(chatToolsSource).toContain("createGuidelineTools(scope)");
    expect(turnSource).toContain("drainGbdTurn(turnId)");
    expect(turnSource).toContain("drainGuidelineTurn(turnId)");
    expect(chatToolsSource).not.toMatch(/createGbdTools\([^)]*oura/);
    expect(chatToolsSource).not.toMatch(/createGbdTools\([^)]*whoop/);
    expect(chatToolsSource).not.toMatch(/createGbdTools\([^)]*googleHealth/);
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
