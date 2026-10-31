import { describe, expect, test } from "bun:test";

import { AF_CODE, afSubsetIds, entryPattern } from "./af-subset";
import { type PersonFacts } from "./person-facts";

const facts = (id: string, onsets: PersonFacts["onsets"]): PersonFacts => ({
  id,
  batch: "001",
  sex: "F",
  birth: "1950-01-01",
  death: null,
  onsets,
  anticoagulantStart: null,
});

describe("afSubsetIds", () => {
  test("keeps people with an AF onset only, sorted, once each", () => {
    const people = [
      facts("c", { af: "2018-01-01" }),
      facts("a", { stroke: "2019-01-01" }),
      facts("b", { af: "2010-05-05", stroke: "2020-01-01" }),
      facts("c", { af: "2018-01-01" }),
    ];
    expect(afSubsetIds(people)).toEqual(["b", "c"]);
  });

  test("selects on the AF code codes.ts lists", () => {
    expect(AF_CODE).toBe("49436004");
  });
});

describe("entryPattern", () => {
  test("matches the archive's file name for an id", () => {
    expect(entryPattern("b5c8cec1-8415-25cf-b544-c19e84761e14")).toBe(
      "fhir/*_b5c8cec1-8415-25cf-b544-c19e84761e14.json",
    );
  });
});
