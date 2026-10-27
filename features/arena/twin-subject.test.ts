import { describe, expect, test } from "bun:test";

import type { ResponseState, ToolActivity, TurnState } from "./conversation";
import { threadSubjectRefs, twinLabel, twinTarget } from "./twin-subject";

/** Synthetic subject_refs, shaped like Synthea patient ids. */
const REF_1 = "0b5c1a2e-1111-4a6b-9c3d-000000000001";
const REF_2 = "0b5c1a2e-2222-4a6b-9c3d-000000000002";
const REF_3 = "0b5c1a2e-3333-4a6b-9c3d-000000000003";
const OUTSIDE = "0b5c1a2e-9999-4a6b-9c3d-000000000009";

const COHORT = [
  { ref: REF_1, label: "Synthetic person 1" },
  { ref: REF_2, label: "Synthetic person 2" },
  { ref: REF_3, label: "Synthetic person 3" },
];

const tool = (subject: string, state: ToolActivity["state"] = "done"): ToolActivity => ({
  id: `call-${subject}`,
  tool: "summary_stats",
  title: "Summarised a measure",
  args: [
    { label: "Measure", value: "8867-4" },
    { label: "Subject", value: subject },
  ],
  state,
  rowCount: state === "done" ? 3 : null,
  note: null,
});

const answer = (tools: readonly ToolActivity[]): ResponseState => ({
  id: "response",
  modelId: "model-a",
  modelName: "Model A",
  status: "COMPLETE",
  text: "",
  metrics: null,
  tools,
});

const turn = (
  id: string,
  prompt: string,
  tools: readonly ToolActivity[] = [],
): TurnState => ({ id, prompt, answers: [answer(tools)] });

describe("threadSubjectRefs", () => {
  test("prompt UUIDs, then each answer's tool subjects, turn by turn", () => {
    expect(
      threadSubjectRefs([
        turn("t1", `Compare ${REF_2} with last year`, [tool(REF_3)]),
        turn("t2", "And now?", [tool(REF_1)]),
      ]),
    ).toEqual([REF_2, REF_3, REF_1]);
  });

  test("a refused or failed call never counts as using its subject", () => {
    expect(
      threadSubjectRefs([
        turn("t1", "Heart rate?", [tool(REF_1, "refused"), tool(REF_2, "error")]),
      ]),
    ).toEqual([]);
  });
});

describe("twinTarget", () => {
  test("synthetic mode: the first subject the thread's tool calls used", () => {
    const target = twinTarget({
      mode: "synthetic",
      turns: [turn("t1", "Heart rate trend?", [tool(REF_3), tool(REF_1)])],
      cohort: COHORT,
    });
    expect(target).toEqual({
      kind: "synthetic",
      ref: REF_3,
      label: "Synthetic person 3",
    });
    expect(twinLabel(target, null)).toBe("Digital twin · Synthetic person 3");
  });

  test("synthetic mode: a subject_ref in a prompt counts when it is in the cohort", () => {
    expect(
      twinTarget({
        mode: "synthetic",
        turns: [turn("t1", `What about ${REF_2.toUpperCase()}?`)],
        cohort: COHORT,
      }),
    ).toEqual({ kind: "synthetic", ref: REF_2, label: "Synthetic person 2" });
  });

  test("synthetic mode: refs outside the loaded cohort are skipped", () => {
    expect(
      twinTarget({
        mode: "synthetic",
        turns: [turn("t1", `Look at ${OUTSIDE}`, [tool(REF_1)])],
        cohort: COHORT,
      }),
    ).toEqual({ kind: "synthetic", ref: REF_1, label: "Synthetic person 1" });
  });

  test("synthetic mode with no subject, or no cohort, is the Demo body", () => {
    const none = twinTarget({
      mode: "synthetic",
      turns: [turn("t1", "Hello")],
      cohort: COHORT,
    });
    expect(none).toEqual({ kind: "demo" });
    expect(twinLabel(none, null)).toBe("Digital twin · Demo body");
    expect(
      twinTarget({
        mode: "synthetic",
        turns: [turn("t1", REF_1, [tool(REF_1)])],
        cohort: [],
      }),
    ).toEqual({ kind: "demo" });
    expect(twinTarget({ mode: "synthetic", turns: [], cohort: COHORT })).toEqual({
      kind: "demo",
    });
  });

  test("personal mode is Self and never reads the thread's synthetic refs", () => {
    const target = twinTarget({
      mode: "personal",
      turns: [turn("t1", `Compare ${REF_1}`, [tool(REF_1)])],
      cohort: COHORT,
    });
    expect(target).toEqual({ kind: "self" });
    expect(twinLabel(target, null)).toBe("Digital twin · Self");
    expect(twinLabel(target, "self")).toBe("Digital twin · Self");
  });

  test("personal mode says so when the viewer finds no Self", () => {
    expect(twinLabel({ kind: "self" }, "demo")).toBe(
      "Digital twin · Demo body (no Self twin here)",
    );
    expect(twinLabel({ kind: "self" }, "other")).toBe(
      "Digital twin · first listed subject (no Self twin here)",
    );
  });
});
