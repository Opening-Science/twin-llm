import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import {
  changedLists,
  saveAuditedSetting,
  saveAuditedSettings,
  settingAuditEvent,
} from "./setting-save";

describe("saveAuditedSettings (the first-run flow)", () => {
  test("writes one audit row per change before the one store", async () => {
    const writes: string[] = [];
    const result = await saveAuditedSettings(
      {
        audit: async (event) => {
          writes.push(`audit ${String(event.tool)}`);
        },
        store: async () => {
          writes.push("store");
        },
        logError: () => undefined,
      },
      {
        actor: "local",
        changes: [
          { setting: "knowledge-sources", value: ["gbd"] },
          { setting: "live-sources", value: ["pubmed"] },
        ],
      },
    );
    expect(result).toEqual({ ok: true });
    expect(writes).toEqual(["audit settings.set", "audit settings.set", "store"]);
  });

  test("stores nothing when an audit row cannot be written", async () => {
    const writes: string[] = [];
    const result = await saveAuditedSettings(
      {
        audit: async () => {
          throw new Error("audit down");
        },
        store: async () => {
          writes.push("store");
        },
        logError: (message, name) => writes.push(`${message}: ${name}`),
      },
      { actor: "local", changes: [{ setting: "live-sources", value: [] }] },
    );
    expect(result.ok).toBe(false);
    expect(writes).toEqual(["[settings] live-sources not saved: Error"]);
  });
});

describe("changedLists", () => {
  test("keeps only the lists that differ from what was stored", () => {
    expect(
      changedLists([
        { setting: "knowledge-sources", before: ["gbd"], after: ["gbd"] },
        { setting: "live-sources", before: [], after: ["pubmed"] },
      ]),
    ).toEqual([{ setting: "live-sources", value: ["pubmed"] }]);
  });
});

/** An in-memory store and audit chain, in the order they were written. */
const fakePorts = <V extends boolean | readonly string[]>(
  failing: "audit" | "store" | null = null,
) => {
  const writes: string[] = [];
  const events: AppendInput[] = [];
  const stored: V[] = [];
  const logged: string[] = [];
  return {
    writes,
    events,
    stored,
    logged,
    ports: {
      audit: async (event: AppendInput) => {
        if (failing === "audit") throw new Error("audit down");
        writes.push("audit");
        events.push(event);
      },
      store: async (value: V) => {
        if (failing === "store") throw new TypeError("db down");
        writes.push("store");
        stored.push(value);
      },
      logError: (message: string, name: string) => logged.push(`${message}: ${name}`),
    },
  };
};

describe("settingAuditEvent", () => {
  test("names the setting and its new value, nothing else", () => {
    expect(settingAuditEvent("local", "twin-notes-loading", false)).toEqual({
      actor: "local",
      sessionId: "settings",
      subjectRef: null,
      tool: "settings.set",
      args: { setting: "twin-notes-loading", value: false },
      result: { saved: true },
      rowCount: 0,
    });
  });
});

describe("saveAuditedSetting", () => {
  test("writes the audit row first, then stores the value", async () => {
    const fake = fakePorts<readonly string[]>();
    const result = await saveAuditedSetting(fake.ports, {
      actor: "local",
      setting: "knowledge-sources",
      value: ["gbd"],
    });
    expect(result).toEqual({ ok: true });
    expect(fake.writes).toEqual(["audit", "store"]);
    expect(fake.stored).toEqual([["gbd"]]);
    expect(fake.events[0]?.args).toEqual({
      setting: "knowledge-sources",
      value: ["gbd"],
    });
  });

  test("stores nothing when the audit row cannot be written", async () => {
    const fake = fakePorts<boolean>("audit");
    const result = await saveAuditedSetting(fake.ports, {
      actor: "local",
      setting: "twin-notes-loading",
      value: false,
    });
    expect(result).toEqual({
      ok: false,
      code: "NOT_SAVED",
      error: "Your choice wasn't saved. Try again in a moment.",
    });
    expect(fake.stored).toEqual([]);
    expect(fake.logged).toEqual(["[settings] twin-notes-loading not saved: Error"]);
  });

  test("a failed store is a sentence, never the database message", async () => {
    const fake = fakePorts<boolean>("store");
    const result = await saveAuditedSetting(fake.ports, {
      actor: "local",
      setting: "twin-notes-loading",
      value: true,
    });
    expect(result).toEqual({
      ok: false,
      code: "NOT_SAVED",
      error: "Your choice wasn't saved. Try again in a moment.",
    });
    expect(fake.logged).toEqual(["[settings] twin-notes-loading not saved: TypeError"]);
  });
});
