import { describe, expect, test } from "bun:test";

import { eventWindows, firstDated } from "./event-windows";

describe("eventWindows", () => {
  test("before ends just before the event; after starts at it", () => {
    expect(eventWindows(new Date("2020-03-10T08:00:00.000Z"), 30, 7)).toEqual({
      before: { start: "2020-02-09T08:00:00.000Z", end: "2020-03-10T07:59:59.999Z" },
      after: { start: "2020-03-10T08:00:00.000Z", end: "2020-03-17T08:00:00.000Z" },
    });
  });
});

describe("firstDated", () => {
  test("earliest dated record wins, ties to the lower id, undated ones are skipped", () => {
    const records = [
      { id: "b", when: new Date("2019-01-01T00:00:00Z") },
      { id: "c", when: null },
      { id: "a", when: new Date("2019-01-01T00:00:00Z") },
      { id: "d", when: new Date("2021-01-01T00:00:00Z") },
    ];
    expect(firstDated(records, (record) => record.when)?.id).toBe("a");
    expect(firstDated([{ id: "x", when: null }], (record) => record.when)).toBeNull();
  });
});
