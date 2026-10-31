import { describe, expect, test } from "bun:test";

import { LIVE_REFUSALS, permitLiveLookup, queryRefusal } from "./refusals";

const turn = { enabled: ["pubmed"] as const, incognito: false, genomeInTurn: false };

describe("permitLiveLookup", () => {
  test("a switched-on source in an ordinary chat may send", () => {
    expect(
      permitLiveLookup({ localOnly: false, turn, sessionId: "turn-1", source: "pubmed" }),
    ).toBe(null);
  });

  test("local-only mode refuses first", () => {
    expect(
      permitLiveLookup({
        localOnly: true,
        turn: { ...turn, incognito: true },
        sessionId: "turn-1",
        source: "pubmed",
      }),
    ).toEqual({
      ok: false,
      code: "LIVE_SOURCE_LOCAL_ONLY",
      error:
        "Live lookups are off on this server because it runs in local-only mode, so nothing was sent.",
    });
  });

  test("an incognito chat refuses, also by its session id alone", () => {
    expect(
      permitLiveLookup({
        localOnly: false,
        turn: { ...turn, incognito: true },
        sessionId: "turn-1",
        source: "pubmed",
      }),
    ).toEqual(LIVE_REFUSALS.incognito);
    expect(
      permitLiveLookup({
        localOnly: false,
        turn,
        sessionId: "incognito-abc",
        source: "pubmed",
      }),
    ).toEqual(LIVE_REFUSALS.incognito);
  });

  test("a source the person did not switch on refuses", () => {
    expect(
      permitLiveLookup({
        localOnly: false,
        turn,
        sessionId: "turn-1",
        source: "ensembl",
      }),
    ).toEqual({
      ok: false,
      code: "LIVE_SOURCE_OFF",
      error:
        "This live source is switched off in Customize · Connectors, so nothing was sent.",
    });
  });
});

describe("queryRefusal", () => {
  test("carries the reason and its sentence", () => {
    expect(queryRefusal("date")).toEqual({
      ok: false,
      code: "LIVE_QUERY_REFUSED",
      reason: "date",
      error: "Search terms may not contain a year or a date, so nothing was sent.",
    });
  });
});
