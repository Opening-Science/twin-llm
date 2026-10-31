import { describe, expect, test } from "bun:test";

import {
  bucketFor,
  groupThreads,
  withoutHiddenThreads,
  withTouchedThreads,
} from "./thread-list";

const now = new Date(2026, 9, 25, 9, 30);

describe("bucketFor", () => {
  test("uses calendar days in local time", () => {
    expect(bucketFor(new Date(2026, 9, 25, 0, 0), now)).toBe("Today");
    expect(bucketFor(new Date(2026, 9, 24, 23, 50), now)).toBe("This week");
    expect(bucketFor(new Date(2026, 9, 19, 0, 0), now)).toBe("This week");
    expect(bucketFor(new Date(2026, 9, 18, 23, 59), now)).toBe("Earlier");
  });
});

describe("groupThreads", () => {
  test("keeps order inside a bucket and leaves out empty buckets", () => {
    expect(
      groupThreads(
        [
          {
            id: "a",
            title: "Synthetic A",
            modelCount: 2,
            updatedAt: new Date(2026, 9, 25, 9),
          },
          {
            id: "b",
            title: "Synthetic B",
            modelCount: 1,
            updatedAt: new Date(2026, 9, 25, 8),
          },
          {
            id: "c",
            title: "Synthetic C",
            modelCount: 3,
            updatedAt: new Date(2026, 8, 1),
          },
        ],
        now,
      ),
    ).toEqual([
      {
        label: "Today",
        threads: [
          { id: "a", title: "Synthetic A", modelCount: 2 },
          { id: "b", title: "Synthetic B", modelCount: 1 },
        ],
      },
      { label: "Earlier", threads: [{ id: "c", title: "Synthetic C", modelCount: 3 }] },
    ]);
  });
});

describe("withTouchedThreads", () => {
  const server = [
    { label: "Today", threads: [{ id: "a", title: "Synthetic A", modelCount: 2 }] },
    { label: "Earlier", threads: [{ id: "c", title: "Synthetic C", modelCount: 3 }] },
  ];

  test("nothing touched leaves the server's groups alone", () => {
    expect(withTouchedThreads(server, [])).toBe(server);
  });

  test("touched threads lead Today; the server's entry wins where it has one", () => {
    expect(
      withTouchedThreads(server, [
        { id: "new", title: "Synthetic new", modelCount: 1 },
        { id: "c", title: "Browser title", modelCount: 1 },
      ]),
    ).toEqual([
      {
        label: "Today",
        threads: [
          { id: "new", title: "Synthetic new", modelCount: 1 },
          { id: "c", title: "Synthetic C", modelCount: 3 },
          { id: "a", title: "Synthetic A", modelCount: 2 },
        ],
      },
    ]);
  });
});

describe("withoutHiddenThreads", () => {
  const groups = [
    { label: "Today", threads: [{ id: "a", title: "A", modelCount: 1 }] },
    {
      label: "Earlier",
      threads: [
        { id: "b", title: "B", modelCount: 2 },
        { id: "c", title: "C", modelCount: 1 },
      ],
    },
  ];

  test("leaves out threads being deleted and drops a group left empty", () => {
    expect(withoutHiddenThreads(groups, new Set(["a", "b"]))).toEqual([
      { label: "Earlier", threads: [{ id: "c", title: "C", modelCount: 1 }] },
    ]);
  });

  test("nothing hidden: the same groups", () => {
    expect(withoutHiddenThreads(groups, new Set())).toBe(groups);
  });
});
