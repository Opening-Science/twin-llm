import { describe, expect, test } from "bun:test";

import { systemForGroup } from "./hra-groups";
import { SYSTEM_IDS } from "./systems";
import {
  focusDepth,
  focusHighlights,
  focusOfPick,
  isTwinFocusId,
  TWIN_FOCUS_IDS,
  TWIN_FOCUS_ORGANS,
  twinFocus,
} from "./twin-focus";

describe("twin focus ids", () => {
  test("are the nine systems, then the focus organs, each once", () => {
    expect(TWIN_FOCUS_IDS).toEqual([...SYSTEM_IDS, ...TWIN_FOCUS_ORGANS]);
    expect(new Set(TWIN_FOCUS_IDS).size).toBe(16);
  });

  test("every focus organ is an HRA group the group table files under a system", () => {
    expect(TWIN_FOCUS_ORGANS.map((organ) => [organ, systemForGroup(organ)])).toEqual([
      ["heart", "cardiovascular"],
      ["lung", "respiratory"],
      ["brain", "nervous"],
      ["liver", "metabolic"],
      ["kidney", "endocrine"],
      ["pancreas", "metabolic"],
      ["bloodvasculature", "cardiovascular"],
    ]);
  });

  test("only listed ids are focus ids", () => {
    expect(isTwinFocusId("liver")).toBe(true);
    expect(isTwinFocusId("nervous")).toBe(true);
    expect(isTwinFocusId("spleen")).toBe(false);
    expect(isTwinFocusId(3)).toBe(false);
  });
});

describe("twinFocus", () => {
  test("an organ names its system", () => {
    expect(twinFocus("bloodvasculature")).toEqual({
      id: "bloodvasculature",
      kind: "organ",
      label: "Blood vessels",
      system: "cardiovascular",
    });
  });

  test("a system is its own", () => {
    expect(twinFocus("respiratory")).toEqual({
      id: "respiratory",
      kind: "system",
      label: "Respiratory system",
      system: "respiratory",
    });
  });
});

describe("focusHighlights", () => {
  test("an organ lights its group on HRA and its system on BodyParts3D", () => {
    expect(focusHighlights("liver")).toEqual({
      hra: { kind: "groups", ids: ["liver"] },
      bodyparts3d: { kind: "system", ids: ["metabolic"] },
    });
  });

  test("a system lights the whole system on both", () => {
    expect(focusHighlights("nervous")).toEqual({
      hra: { kind: "system", ids: ["nervous"] },
      bodyparts3d: { kind: "system", ids: ["nervous"] },
    });
  });
});

describe("focusOfPick", () => {
  test("a focus organ wins over its system", () => {
    expect(focusOfPick("liver", "metabolic")).toBe("liver");
  });

  test("another group falls back to its system", () => {
    expect(focusOfPick("spleen", "metabolic")).toBe("metabolic");
  });

  test("BodyParts3D parts have no group and name their system", () => {
    expect(focusOfPick(null, "musculoskeletal")).toBe("musculoskeletal");
  });

  test("nothing known is null", () => {
    expect(focusOfPick(null, "unassigned")).toBeNull();
    expect(focusOfPick("nervous", null)).toBeNull();
  });
});

describe("focusDepth", () => {
  test("organs and most systems start at the organ layer", () => {
    expect(focusDepth("liver")).toBe(3);
    expect(focusDepth("cardiovascular")).toBe(3);
  });

  test("muscle and bone start at muscle, skin at the scan", () => {
    expect(focusDepth("musculoskeletal")).toBe(1);
    expect(focusDepth("integumentary")).toBe(0);
  });
});
