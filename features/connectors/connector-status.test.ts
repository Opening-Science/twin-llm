import { describe, expect, test } from "bun:test";

import { connectorBadge, loopbackHostHint, syncDetail } from "./connector-status";

describe("connectorBadge", () => {
  test("maps every state to one label and tone", () => {
    const badge = (configured: boolean, connected: boolean, failed: boolean) =>
      connectorBadge({ configured, connected, failed });

    expect(badge(false, false, false)).toEqual({ label: "Not configured", tone: "off" });
    // Missing env wins even over a failure or a stale connection row.
    expect(badge(false, true, true)).toEqual({ label: "Not configured", tone: "off" });
    expect(badge(true, false, false)).toEqual({
      label: "Not connected",
      tone: "neutral",
    });
    expect(badge(true, true, false)).toEqual({ label: "Connected", tone: "ok" });
    expect(badge(true, false, true)).toEqual({ label: "Error", tone: "warn" });
    expect(badge(true, true, true)).toEqual({ label: "Error", tone: "warn" });
  });
});

describe("syncDetail", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");

  test("says when the last sync was, or that there was none", () => {
    expect(syncDetail("2026-10-20T09:00:00Z", NOW)).toBe("Synced 3 h ago");
    expect(syncDetail("2026-10-20T11:30:00Z", NOW)).toBe("Synced just now");
    expect(syncDetail(null, NOW)).toBe("Not synced yet");
  });
});

describe("loopbackHostHint", () => {
  test("names the localhost URL when the page is on a loopback IP", () => {
    expect(loopbackHostHint("127.0.0.1", "3000")).toBe(
      "You opened TwinLLM at 127.0.0.1. Sign-in returns go to localhost, so open http://localhost:3000/connectors before linking.",
    );
    expect(loopbackHostHint("[::1]", "")).toBe(
      "You opened TwinLLM at [::1]. Sign-in returns go to localhost, so open http://localhost/connectors before linking.",
    );
  });

  test("stays quiet on localhost or a real host", () => {
    expect(loopbackHostHint("localhost", "3000")).toBeNull();
    expect(loopbackHostHint("twinllm.example.invalid", "")).toBeNull();
  });
});
