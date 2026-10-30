import { describe, expect, test } from "bun:test";

import { metaFile, parsePeopleLines, peopleFile } from "./people-files";

describe("people files", () => {
  test("paths sit under <out>/people", () => {
    expect(peopleFile("out", "007")).toBe("out/people/batch-007.jsonl");
    expect(metaFile("out", "007")).toBe("out/people/batch-007.meta.json");
  });

  test("one person per non-empty line", () => {
    const line = JSON.stringify({ id: "p", batch: "001", sex: "F", birth: "1950-01-01" });
    expect(parsePeopleLines(`${line}\n\n${line}\n`)).toHaveLength(2);
    expect(parsePeopleLines("")).toEqual([]);
  });
});
