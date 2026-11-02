import { describe, expect, test } from "bun:test";

import { GBD_CAUSE_TABLE } from "./cause-table";
import { gbdCauseById, gbdCauseLevel } from "./causes";

describe("GBD cause table", () => {
  test("All causes is the only root; every parent is one level up", () => {
    const byId = new Map(GBD_CAUSE_TABLE.map((entry) => [entry[0], entry] as const));
    const roots = GBD_CAUSE_TABLE.filter((entry) => entry[1] === null);
    expect(roots.map((entry) => entry[0])).toEqual([294]);
    for (const [id, parentId, level] of GBD_CAUSE_TABLE) {
      if (parentId === null) continue;
      expect([id, byId.get(parentId)?.[2]]).toEqual([id, level - 1]);
    }
  });

  test("holds the three level 1 groups and 22 level 2 causes", () => {
    expect(gbdCauseLevel(295)).toBe(1);
    expect(gbdCauseLevel(409)).toBe(1);
    expect(gbdCauseLevel(687)).toBe(1);
    expect(GBD_CAUSE_TABLE.filter((entry) => entry[2] === 2)).toHaveLength(22);
  });

  test("gives levels by id and nothing for an unknown id", () => {
    expect(gbdCauseById(491)).toEqual({
      id: 491,
      parentId: 409,
      level: 2,
      name: "cardiovascular_diseases",
    });
    expect(gbdCauseLevel(294)).toBe(0);
    expect(gbdCauseLevel(587)).toBe(3);
    expect(gbdCauseLevel(999_999)).toBeNull();
  });
});
