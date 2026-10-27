import { describe, expect, test } from "bun:test";

import {
  blendThreadHits,
  inTab,
  matchItems,
  nextTab,
  type SearchItem,
  snippetAround,
  wordScore,
} from "./search-model";

const page = (title: string, detail?: string): SearchItem => ({
  kind: "page",
  id: title,
  title,
  ...(detail ? { detail } : {}),
  href: `/${title.toLowerCase()}`,
});

describe("wordScore", () => {
  test("a prefix beats a word start beats words anywhere", () => {
    expect(wordScore("dat", "Data")).toBe(3);
    expect(wordScore("twin", "Digital Twin")).toBe(2);
    expect(wordScore("heart sleep", "sleep and heart rate")).toBe(1);
    expect(wordScore("glucose", "Data")).toBe(0);
  });

  test("case, accents and spacing do not matter; an empty query matches nothing", () => {
    expect(wordScore("  CAFÉ ", "cafe menu")).toBe(3);
    expect(wordScore("", "Data")).toBe(0);
  });
});

describe("matchItems", () => {
  const items = [page("Connectors"), page("Data", "synthetic cohort"), page("Docs")];

  test("best match first, ties keep their order", () => {
    expect(matchItems("d", items).map((item) => item.title)).toEqual(["Data", "Docs"]);
  });

  test("a match in the detail ranks under a title match", () => {
    expect(matchItems("cohort", items).map((item) => item.title)).toEqual(["Data"]);
    expect(matchItems("co", items).map((item) => item.title)).toEqual([
      "Connectors",
      "Data",
    ]);
  });
});

describe("tabs", () => {
  test("each tab shows its kinds; All shows everything", () => {
    const command: SearchItem = { kind: "command", id: "c", title: "/sleep" };
    expect(inTab("all", command)).toBe(true);
    expect(inTab("commands", command)).toBe(true);
    expect(inTab("threads", command)).toBe(false);
  });

  test("arrows cycle the tabs both ways", () => {
    expect(nextTab("all", 1)).toBe("threads");
    expect(nextTab("all", -1)).toBe("commands");
    expect(nextTab("commands", 1)).toBe("all");
  });
});

describe("blendThreadHits", () => {
  const hit = (threadId: string, updatedAt: string, snippet?: string) => ({
    threadId,
    title: `Thread ${threadId}`,
    updatedAt,
    ...(snippet ? { snippet } : {}),
  });

  test("word matches first by date, then meaning matches by distance, one row per thread", () => {
    const items = blendThreadHits(
      [hit("a", "2026-10-01", "systolic"), hit("b", "2026-10-20")],
      [
        { ...hit("c", "2026-10-25"), distance: 0.4 },
        { ...hit("a", "2026-10-01"), distance: 0.1 },
        { ...hit("d", "2026-10-25"), distance: 0.2 },
      ],
      10,
    );
    expect(items.map((item) => [item.id, item.match])).toEqual([
      ["b", "words"],
      ["a", "words"],
      ["d", "meaning"],
      ["c", "meaning"],
    ]);
    expect(items[1]?.detail).toBe("systolic");
    expect(items[0]?.href).toBe("/t/b");
  });

  test("meaning matches past the distance cut-off are dropped, and the limit holds", () => {
    expect(
      blendThreadHits([], [{ ...hit("far", "2026-10-01"), distance: 0.7 }], 10),
    ).toEqual([]);
    expect(
      blendThreadHits([hit("a", "1"), hit("b", "2"), hit("c", "3")], [], 2),
    ).toHaveLength(2);
  });
});

describe("snippetAround", () => {
  test("cuts around the first matching word with ellipses", () => {
    const text = `${"x ".repeat(80)}the systolic pressure was 131 ${"y ".repeat(80)}`;
    const snippet = snippetAround(text, "systolic");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("systolic pressure was 131");
  });

  test("short text comes back whole, on one line", () => {
    expect(snippetAround("Heart\nrate  today", "rate")).toBe("Heart rate today");
  });
});
