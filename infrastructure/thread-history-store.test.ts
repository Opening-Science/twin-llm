import { describe, expect, test } from "bun:test";

import { withThreadHidden, withTouchedThread } from "./thread-history-store";

describe("withTouchedThread", () => {
  test("puts the latest thread first and keeps one entry per id", () => {
    const first = withTouchedThread([], { id: "a", title: "A", modelCount: 2 });
    const second = withTouchedThread(first, { id: "b", title: "B", modelCount: 1 });
    const again = withTouchedThread(second, { id: "a", title: "A again", modelCount: 3 });
    expect(again).toEqual([
      { id: "a", title: "A again", modelCount: 3 },
      { id: "b", title: "B", modelCount: 1 },
    ]);
  });
});

describe("withThreadHidden", () => {
  test("adds and removes an id, and keeps the same set when nothing changes", () => {
    const empty: ReadonlySet<string> = new Set();
    const one = withThreadHidden(empty, { id: "a", hidden: true });
    expect([...one]).toEqual(["a"]);
    expect(withThreadHidden(one, { id: "a", hidden: true })).toBe(one);
    expect([...withThreadHidden(one, { id: "a", hidden: false })]).toEqual([]);
    expect(withThreadHidden(empty, { id: "b", hidden: false })).toBe(empty);
  });
});
