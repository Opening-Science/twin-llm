import { describe, expect, test } from "bun:test";

import type { LedgerEntry } from "@/infrastructure/disclosure-ledger";

import { freeTextOf, ledgerView } from "./disclosure-view";

const at = (hour: number): Date => new Date(Date.UTC(2026, 9, 31, hour, 0));

const MODEL: LedgerEntry = {
  seq: 2n,
  ts: at(14),
  kind: "hosted-model",
  direction: "sent",
  recipient: "exoscale",
  target: "swiss-ai/Apertus-8B-Instruct-2509",
  purpose: "chat answer",
  categories: ["question text", "wearable summary"],
  refCount: 1,
  payloadBytes: 4200,
  threadId: "thread-synthetic-1",
  synthetic: false,
  freeTextChecked: true,
  freeTextMatches: [{ kind: "rsID", count: 1 }],
};

const SYNC: LedgerEntry = {
  seq: 1n,
  ts: at(9),
  kind: "vendor-sync",
  direction: "sent",
  recipient: "Oura",
  target: "sandbox data download",
  purpose: "sync",
  categories: ["access token", "date window"],
  refCount: 0,
  payloadBytes: null,
  threadId: null,
  synthetic: true,
  freeTextChecked: false,
  freeTextMatches: null,
};

describe("ledgerView (#140)", () => {
  test("a line per recipient and an entry per event, with references, no values", () => {
    const view = ledgerView(
      [MODEL, SYNC],
      [
        { ...MODEL, refs: [{ source: "wearable", key: "oura.sleep.score.2026-10-30" }] },
        { ...SYNC, refs: [] },
      ],
    );
    expect(view).toEqual({
      recipients: [
        {
          key: "sent|exoscale",
          recipient: "exoscale",
          direction: "Sent",
          events: "1",
          since: "31 Oct 2026, 14:00 UTC",
          last: "31 Oct 2026, 14:00 UTC",
          values: "1",
          size: "4.2 kB",
          categories: "question text (1), wearable summary (1)",
        },
        {
          key: "sent|Oura",
          recipient: "Oura",
          direction: "Sent",
          events: "1, 1 synthetic",
          since: "31 Oct 2026, 09:00 UTC",
          last: "31 Oct 2026, 09:00 UTC",
          values: "0",
          size: "not measured",
          categories: "access token (1), date window (1)",
        },
      ],
      entries: [
        {
          key: "2",
          when: "31 Oct 2026, 14:00 UTC",
          recipient: "exoscale · swiss-ai/Apertus-8B-Instruct-2509",
          direction: "Sent",
          what: "Model request: chat answer",
          categories: "question text, wearable summary",
          values: "1",
          size: "4.2 kB",
          synthetic: false,
          threadHref: "/t/thread-synthetic-1",
          refs: ["Wearable: oura.sleep.score.2026-10-30"],
          freeText: "1 rsID",
          freeTextFound: true,
        },
        {
          key: "1",
          when: "31 Oct 2026, 09:00 UTC",
          recipient: "Oura · sandbox data download",
          direction: "Sent",
          what: "Wearable sync: sync",
          categories: "access token, date window",
          values: "0",
          size: "not measured",
          synthetic: true,
          threadHref: null,
          refs: [],
          freeText: "not checked",
          freeTextFound: false,
        },
      ],
      shownOf: null,
    });
  });

  test("says when only the latest events are listed", () => {
    expect(ledgerView([MODEL, SYNC], [{ ...MODEL, refs: [] }]).shownOf).toBe(
      "The latest 1 of 2 events.",
    );
  });

  test("an export reads once, not as its kind and its purpose", () => {
    const exported: LedgerEntry = {
      ...MODEL,
      kind: "export-file",
      recipient: "export file",
      target: "fhir",
      purpose: "thread export",
    };
    expect(ledgerView([exported], [{ ...exported, refs: [] }]).entries[0]?.what).toBe(
      "Thread export",
    );
  });

  test("the free text check reads as kinds and counts, or as not checked (#346)", () => {
    expect(freeTextOf({ freeTextChecked: true, freeTextMatches: [] })).toEqual({
      text: "no stored values found",
      found: false,
    });
    expect(
      freeTextOf({
        freeTextChecked: true,
        freeTextMatches: [
          { kind: "genome site", count: 2 },
          { kind: "body scan label", count: 1 },
        ],
      }),
    ).toEqual({ text: "2 genome sites, 1 body scan label", found: true });
    expect(freeTextOf({ freeTextChecked: false, freeTextMatches: null })).toEqual({
      text: "not checked",
      found: false,
    });
    expect(
      freeTextOf({ freeTextChecked: true, freeTextMatches: [{ kind: "x", count: 1 }] }),
    ).toEqual({ text: "not checked", found: false });
  });

  test("an empty ledger shows nothing", () => {
    expect(ledgerView([], [])).toEqual({ recipients: [], entries: [], shownOf: null });
  });
});
