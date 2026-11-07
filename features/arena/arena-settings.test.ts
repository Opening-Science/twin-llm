import { describe, expect, test } from "bun:test";

import { arenaSettingsFrom } from "./arena-settings";

describe("arenaSettingsFrom", () => {
  test("BodyLoop off: the chat's twins are told it is not configured", () => {
    expect(arenaSettingsFrom("synthetic", null)).toEqual({
      dataMode: "synthetic",
      bodyLoopConfigured: false,
    });
  });

  test("BodyLoop configured: a boolean only, never the key or the folder", () => {
    const settings = arenaSettingsFrom("personal", {
      encryptionKey: "made-up-key",
      dataDir: "/made/up",
    });
    expect(settings).toEqual({ dataMode: "personal", bodyLoopConfigured: true });
    expect(JSON.stringify(settings)).not.toContain("made-up");
  });
});
