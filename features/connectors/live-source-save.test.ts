import { describe, expect, test } from "bun:test";

import { decideLiveSourceSave, liveSourceAuditEvent } from "./live-source-save";

describe("decideLiveSourceSave", () => {
  test("stores the cleaned list", () => {
    expect(decideLiveSourceSave(["ensembl", "x", "pubmed"], false)).toEqual({
      ok: true,
      enabled: ["pubmed", "ensembl"],
    });
  });

  test("local-only mode refuses any source on, with a code", () => {
    expect(decideLiveSourceSave(["pubmed"], true)).toEqual({
      ok: false,
      code: "LIVE_SOURCE_LOCAL_ONLY",
      error:
        "Live lookups are off on this server because it runs in local-only mode, so nothing was sent.",
    });
  });

  test("turning everything off is always allowed", () => {
    expect(decideLiveSourceSave([], true)).toEqual({ ok: true, enabled: [] });
  });
});

describe("liveSourceAuditEvent", () => {
  test("records which sources are on and nothing else", () => {
    expect(liveSourceAuditEvent("local", ["pubmed"])).toEqual({
      actor: "local",
      sessionId: "live-sources",
      subjectRef: null,
      tool: "live.sources.set",
      args: { enabled: ["pubmed"] },
      result: { saved: true },
      rowCount: 0,
    });
  });
});
