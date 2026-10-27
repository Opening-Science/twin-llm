import { describe, expect, test } from "bun:test";

import {
  DEMO_SUBJECT_ID,
  defaultSubjectId,
  demoBodySex,
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

describe("demoBodySex", () => {
  test("male until a person with a stored sex is shown", () => {
    expect(demoBodySex(null, "", null)).toBe("male");
    expect(demoBodySex(null, "syn-a", null)).toBe("male");
    expect(demoBodySex(null, "syn-a", "female")).toBe("female");
  });

  test("a body picked by hand wins for that person and for people without a sex", () => {
    const pick = { personRef: "syn-a", sex: "male" } as const;
    expect(demoBodySex(pick, "syn-a", "female")).toBe("male");
    expect(demoBodySex(pick, "syn-b", null)).toBe("male");
  });

  test("another person with a stored sex brings their own body back", () => {
    const pick = { personRef: "syn-a", sex: "male" } as const;
    expect(demoBodySex(pick, "syn-c", "female")).toBe("female");
  });
});
