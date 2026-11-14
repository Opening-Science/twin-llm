import { describe, expect, test } from "bun:test";

import type { NumberSource } from "@/infrastructure/number-sources";

import { numberLinks, numbersByCall, splitNumbers } from "./number-links";

const SOURCES: readonly NumberSource[] = [
  { text: "72.5", start: 30, end: 34, toolCallId: "call-1", rowIndex: 2, field: "value" },
  { text: "72.5", start: 30, end: 34, toolCallId: "call-2" },
  { text: "78", start: 24, end: 26, toolCallId: "call-1", rowIndex: 6, field: "value" },
  { text: "78", start: 24, end: 26, toolCallId: "call-1", rowIndex: 2, field: "value" },
];

describe("number links (SPEC 5.4)", () => {
  test("each sourced number links to every call that holds it", () => {
    const links = numberLinks(SOURCES);
    expect(links.get("72.5")?.callIds).toEqual(["call-1", "call-2"]);
    expect(links.get("78")?.callIds).toEqual(["call-1"]);
  });

  test("sourced numbers become links; others, dates and small counts stay text", () => {
    const links = numberLinks(SOURCES);
    const pieces = splitNumbers(
      "Heart rate fell from 78 to 72.5 bpm over 3 weeks, 64 elsewhere.",
      links,
    );
    expect(
      pieces.filter((piece) => piece.kind === "number").map((piece) => piece.text),
    ).toEqual(["78", "72.5"]);
    expect(pieces.map((piece) => piece.text).join("")).toBe(
      "Heart rate fell from 78 to 72.5 bpm over 3 weeks, 64 elsewhere.",
    );
  });

  test("a date is never a link, even when its digits match", () => {
    const links = numberLinks([{ text: "2026", start: 0, end: 4, toolCallId: "call-1" }]);
    expect(
      splitNumbers("On 2026-03-01 it fell.", links).every(
        (piece) => piece.kind === "text",
      ),
    ).toBe(true);
  });

  test("without links the run is one piece of text", () => {
    expect(splitNumbers("78 bpm", new Map())).toEqual([{ kind: "text", text: "78 bpm" }]);
  });

  test("a card lists its numbers with rows counted from 1 and fields", () => {
    const byCall = numbersByCall(SOURCES);
    expect(byCall.get("call-1")).toEqual([
      { text: "72.5", where: "row 3 · value" },
      { text: "78", where: "rows 3, 7 · value" },
    ]);
    expect(byCall.get("call-2")).toEqual([{ text: "72.5", where: "" }]);
  });
});
