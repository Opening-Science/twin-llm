import { describe, expect, test } from "bun:test";

import {
  badgeLabel,
  NO_NOTICE,
  noticeSentence,
  readNotice,
  toastIsDue,
} from "./task-notice-model";

const ONE = {
  unseen: 1,
  latest: { skill: "sleep", threadId: "t1", at: "2026-01-15T07:00:30.000Z" },
};

describe("readNotice", () => {
  test("reads the route's body", () => {
    expect(readNotice(ONE)).toEqual(ONE);
    expect(readNotice({ unseen: 0, latest: null })).toEqual(NO_NOTICE);
  });

  test("anything else is no notice", () => {
    expect(readNotice(null)).toEqual(NO_NOTICE);
    expect(readNotice({ unseen: "2" })).toEqual(NO_NOTICE);
    expect(readNotice({ unseen: -1, latest: null })).toEqual(NO_NOTICE);
    expect(readNotice({ unseen: 2, latest: { skill: 1 } })).toEqual({
      unseen: 2,
      latest: null,
    });
  });
});

describe("toastIsDue", () => {
  test("once per new result", () => {
    expect(toastIsDue(NO_NOTICE, null)).toBe(false);
    expect(toastIsDue(ONE, null)).toBe(true);
    expect(toastIsDue(ONE, ONE.latest.at)).toBe(false);
    expect(
      toastIsDue(
        { unseen: 2, latest: { ...ONE.latest, at: "2026-01-16T07:00:30.000Z" } },
        ONE.latest.at,
      ),
    ).toBe(true);
  });
});

describe("words", () => {
  test("sentence and badge label", () => {
    expect(noticeSentence(ONE)).toBe("Scheduled /sleep finished.");
    expect(noticeSentence({ ...ONE, unseen: 3 })).toBe(
      "Scheduled /sleep finished. 2 more unseen on Customize · Tasks.",
    );
    expect(noticeSentence(NO_NOTICE)).toBe("");
    expect(badgeLabel(1)).toBe("1 unseen scheduled run");
    expect(badgeLabel(4)).toBe("4 unseen scheduled runs");
  });
});
