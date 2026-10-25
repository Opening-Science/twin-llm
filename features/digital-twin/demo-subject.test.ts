import { describe, expect, test } from "bun:test";

import {
  DEMO_SUBJECT_ID,
  defaultSubjectId,
  isDemoSubject,
  subjectOptions,
} from "./demo-subject";

const SELF = { id: "sub-self", label: "Self", isSelf: true };
const FILE = { id: "sub-file", label: "Export", isSelf: false };

describe("demo subject", () => {
  test("with no real subjects the picker lists only the demo, and it is the default", () => {
    expect(subjectOptions([])).toEqual([{ id: "demo", label: "Demo (synthetic)" }]);
    expect(defaultSubjectId([])).toBe(DEMO_SUBJECT_ID);
  });

  test("real subjects come first, Self marked, and Self stays the default", () => {
    expect(subjectOptions([FILE, SELF])).toEqual([
      { id: "sub-file", label: "Export" },
      { id: "sub-self", label: "Self (self)" },
      { id: "demo", label: "Demo (synthetic)" },
    ]);
    expect(defaultSubjectId([FILE, SELF])).toBe("sub-self");
  });

  test("without Self the first real subject is the default", () => {
    expect(defaultSubjectId([FILE])).toBe("sub-file");
  });

  test("only the demo id is the demo", () => {
    expect(isDemoSubject("demo")).toBe(true);
    expect(isDemoSubject("sub-self")).toBe(false);
    expect(isDemoSubject("")).toBe(false);
  });
});
