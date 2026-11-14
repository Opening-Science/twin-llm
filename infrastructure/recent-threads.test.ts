import { describe, expect, test } from "bun:test";

import { mergeRecentThreads, type ShellThread } from "./recent-threads";

const HEART: ShellThread = {
  id: "t3",
  title: "Resting heart rate",
  updatedAt: "2026-11-14T09:00:00.000Z",
  modelCount: 3,
};
const SLEEP: ShellThread = {
  id: "t2",
  title: "Sleep stages",
  updatedAt: "2026-11-12T09:00:00.000Z",
  modelCount: 1,
};
const STEPS: ShellThread = {
  id: "t1",
  title: "Step count",
  updatedAt: "2026-10-01T09:00:00.000Z",
  modelCount: 2,
};
const SERVER = [HEART, SLEEP, STEPS];

describe("mergeRecentThreads", () => {
  test("keeps the server's order when this tab touched nothing", () => {
    expect(mergeRecentThreads(SERVER, [], new Set()).map(({ id }) => id)).toEqual([
      "t3",
      "t2",
      "t1",
    ]);
  });

  test("puts touched threads first and prefers the server's row", () => {
    const merged = mergeRecentThreads(
      SERVER,
      [
        { id: "new", title: "A new question", modelCount: 2 },
        { id: "t1", title: "Step count (tab)", modelCount: 1 },
      ],
      new Set(),
    );
    expect(merged).toEqual([
      {
        id: "new",
        title: "A new question",
        modelCount: 2,
        updatedAt: null,
        touched: true,
      },
      { ...STEPS, touched: true },
      { ...HEART, touched: false },
      { ...SLEEP, touched: false },
    ]);
  });

  test("leaves out threads whose delete is pending, touched or not", () => {
    const merged = mergeRecentThreads(
      SERVER,
      [{ id: "t3", title: "Resting heart rate", modelCount: 3 }],
      new Set(["t3", "t2"]),
    );
    expect(merged.map(({ id }) => id)).toEqual(["t1"]);
  });
});
