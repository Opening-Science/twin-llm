import { describe, expect, test } from "bun:test";

import { loadSubjects } from "./load-subjects";

const SUBJECT = { id: "sub-1", label: "Synthetic", isSelf: false };

const counting = (body: unknown) => {
  const calls: string[] = [];
  const fetchSubjects = async () => {
    calls.push("subjects");
    return body;
  };
  return { calls, fetchSubjects };
};

describe("loadSubjects", () => {
  test("with BodyLoop off it makes no request and lists no subjects", async () => {
    const { calls, fetchSubjects } = counting({ subjects: [SUBJECT] });
    expect(await loadSubjects({ bodyLoopConfigured: false, fetchSubjects })).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("with BodyLoop on it lists the subjects the route returns", async () => {
    const { calls, fetchSubjects } = counting({ subjects: [SUBJECT] });
    expect(await loadSubjects({ bodyLoopConfigured: true, fetchSubjects })).toEqual([
      SUBJECT,
    ]);
    expect(calls).toEqual(["subjects"]);
  });

  test("a refused answer is no subjects", async () => {
    const { fetchSubjects } = counting(null);
    expect(await loadSubjects({ bodyLoopConfigured: true, fetchSubjects })).toEqual([]);
  });
});
