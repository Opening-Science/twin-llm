import { describe, expect, test } from "bun:test";

import {
  emptyRatingFile,
  lineKey,
  parseRatingFile,
  ratingsByLine,
  ratingsExport,
  renderRatingFile,
  withRating,
} from "./rating-file";

const T0 = "2026-10-31T10:00:00.000Z";
const T1 = "2026-10-31T10:05:00.000Z";

describe("rating file", () => {
  const empty = emptyRatingFile("run-a", "rater-b", "second-rater.v1:rater-b", T0);

  test("starts empty with the rubric and seed", () => {
    expect(empty).toEqual({
      schema_version: "twin-llm.eval.ratings.v1",
      rubric: "second-rater.v1",
      run_id: "run-a",
      rater: "rater-b",
      order_seed: "second-rater.v1:rater-b",
      updated: T0,
      ratings: [],
    });
  });

  test("sets, replaces and clears a rating, kept in item order", () => {
    const one = withRating(empty, { itemId: "Q-S7-71", repeat: 2 }, 4, " loose ", T0);
    const two = withRating(one, { itemId: "Q-S7-70", repeat: 1 }, 5, "", T1);
    const replaced = withRating(two, { itemId: "Q-S7-71", repeat: 2 }, 3, "", T1);
    expect(replaced.ratings).toEqual([
      { item_id: "Q-S7-70", repeat: 1, level: 5, comment: "", rated_at: T1 },
      { item_id: "Q-S7-71", repeat: 2, level: 3, comment: "", rated_at: T1 },
    ]);
    expect(one.ratings[0]?.comment).toBe("loose");
    const cleared = withRating(replaced, { itemId: "Q-S7-70", repeat: 1 }, null, "", T1);
    expect(
      cleared.ratings.map((rating) => lineKey(rating.item_id, rating.repeat)),
    ).toEqual(["Q-S7-71#2"]);
    expect(cleared.updated).toBe(T1);
  });

  test("round-trips through its text form", () => {
    const file = withRating(empty, { itemId: "Q-S7-70", repeat: 1 }, 5, "ok", T1);
    const text = renderRatingFile(file);
    expect(text.endsWith("}\n")).toBe(true);
    expect(parseRatingFile(text)).toEqual(file);
  });

  test("refuses other shapes", () => {
    expect(parseRatingFile("not json")).toBeNull();
    expect(
      parseRatingFile(JSON.stringify({ ...empty, schema_version: "v0" })),
    ).toBeNull();
    expect(
      parseRatingFile(
        JSON.stringify({
          ...empty,
          ratings: [{ item_id: "Q", repeat: 1, level: 6, comment: "", rated_at: T0 }],
        }),
      ),
    ).toBeNull();
  });

  test("ratings by line and the export document", () => {
    const file = withRating(empty, { itemId: "Q-S7-70", repeat: 1 }, 5, "", T1);
    expect([...ratingsByLine(file).keys()]).toEqual(["Q-S7-70#1"]);
    const other = { ...file, run_id: "run-0" };
    expect(ratingsExport("rater-b", [file, other])).toEqual({
      schema_version: "twin-llm.eval.ratings-export.v1",
      rater: "rater-b",
      rubric: "second-rater.v1",
      files: [other, file],
    });
  });
});
