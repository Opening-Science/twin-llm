import { describe, expect, test } from "bun:test";

import { withTouchedThread } from "./thread-history-store";

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
