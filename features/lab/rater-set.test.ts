import { describe, expect, test } from "bun:test";

import {
  newRaterSet,
  parseRaterSet,
  RATER_SET_SCHEMA_VERSION,
  renderRaterSet,
} from "./rater-set";

const SALT = "0123456789abcdef".repeat(4);

describe("rater set", () => {
  test("a new set names the rubric, the rater and the salt, and round-trips", () => {
    const set = newRaterSet("rater-b", SALT, "2026-10-31T10:00:00.000Z");
    expect(set).toEqual({
      schema_version: RATER_SET_SCHEMA_VERSION,
      rubric: "second-rater.v1",
      rater: "rater-b",
      salt: SALT,
      created: "2026-10-31T10:00:00.000Z",
    });
    const text = renderRaterSet(set);
    expect(text.endsWith("}\n")).toBe(true);
    expect(parseRaterSet(text)).toEqual(set);
  });

  test("anything else is not a rater set", () => {
    const set = newRaterSet("rater-b", SALT, "2026-10-31T10:00:00.000Z");
    expect(parseRaterSet("not json")).toBeNull();
    expect(parseRaterSet(JSON.stringify({ ...set, salt: "short" }))).toBeNull();
    expect(parseRaterSet(JSON.stringify({ ...set, extra: 1 }))).toBeNull();
    expect(parseRaterSet(JSON.stringify({ ...set, schema_version: "v0" }))).toBeNull();
  });
});
