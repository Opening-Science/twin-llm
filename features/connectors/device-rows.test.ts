import { describe, expect, test } from "bun:test";

import { detailLine } from "@/infrastructure/charts/kit";

import {
  deviceRow,
  deviceStatus,
  syncedPhrase,
  type DeviceRowInput,
} from "./device-rows";

const NOW = Date.parse("2026-11-09T12:00:00Z");

const input = (over: Partial<DeviceRowInput> = {}): DeviceRowInput => ({
  source: "oura",
  configured: true,
  connected: true,
  lastSyncAt: "2026-11-09T10:00:00Z",
  failed: false,
  ...over,
});

describe("deviceStatus", () => {
  test("a recent sync is linked", () => {
    expect(deviceStatus(input(), NOW)).toEqual({ word: "Linked", tone: "ok" });
  });

  test("a link not synced for more than two days is stale", () => {
    expect(deviceStatus(input({ lastSyncAt: "2026-11-07T11:00:00Z" }), NOW)).toEqual({
      word: "Stale",
      tone: "warn",
    });
    expect(deviceStatus(input({ lastSyncAt: "2026-11-07T13:00:00Z" }), NOW).word).toBe(
      "Linked",
    );
  });

  test("a link that has not synced yet is linked, not stale", () => {
    expect(deviceStatus(input({ lastSyncAt: null }), NOW).word).toBe("Linked");
  });

  test("not linked, not set up and a failure each have their word", () => {
    expect(deviceStatus(input({ connected: false }), NOW)).toEqual({
      word: "Not linked",
      tone: "neutral",
    });
    expect(deviceStatus(input({ configured: false, failed: true }), NOW)).toEqual({
      word: "Not set up",
      tone: "neutral",
    });
    expect(deviceStatus(input({ failed: true }), NOW)).toEqual({
      word: "Error",
      tone: "warn",
    });
  });
});

describe("syncedPhrase", () => {
  test("says the last sync in plain words", () => {
    expect(syncedPhrase("2026-11-09T11:59:30Z", NOW)).toBe("synced just now");
    expect(syncedPhrase("2026-11-09T11:59:00Z", NOW)).toBe("synced 1 minute ago");
    expect(syncedPhrase("2026-11-09T11:56:00Z", NOW)).toBe("synced 4 minutes ago");
    expect(syncedPhrase("2026-11-09T10:00:00Z", NOW)).toBe("synced 2 hours ago");
    expect(syncedPhrase("2026-11-06T12:00:00Z", NOW)).toBe("synced 3 days ago");
    expect(syncedPhrase(null, NOW)).toBe("not synced yet");
  });
});

describe("deviceRow", () => {
  test("a linked WHOOP row credits WHOOP before the sync", () => {
    const row = deviceRow(input({ source: "whoop" }), NOW);
    expect(row.name).toBe("WHOOP");
    expect(detailLine(row)).toBe("Data by WHOOP · synced 2 hours ago");
  });

  test("a linked Google Health row says it is connected to Google Health", () => {
    const row = deviceRow(input({ source: "google-health" }), NOW);
    expect(detailLine(row)).toBe("Connected to Google Health · synced 2 hours ago");
    expect(row.logo?.alt).toBe("Google Health");
  });

  test("Oura has an empty tile and a plain sync line", () => {
    const row = deviceRow(input(), NOW);
    expect(row.logo).toBeUndefined();
    expect(detailLine(row)).toBe("Synced 2 hours ago");
  });

  test("an unlinked row shows what the source is for, with no data credit", () => {
    const row = deviceRow(
      input({ source: "whoop", connected: false, idleDetail: "Recovery and strain." }),
      NOW,
    );
    expect(detailLine(row)).toBe("Recovery and strain.");
    expect(row.logo?.alt).toBe("WHOOP");
    expect(row.status).toEqual({ word: "Not linked", tone: "neutral" });
  });
});
