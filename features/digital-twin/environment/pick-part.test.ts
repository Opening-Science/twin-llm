import { describe, expect, test } from "bun:test";

import { markerRows } from "../biomarkers/biomarker-rows";
import {
  choosePick,
  isTap,
  linkedRows,
  pickHighlight,
  pickHighlights,
  pickTarget,
  pickVisible,
  type PickablePart,
} from "./pick-part";

const LAYERS = { muscle: true, skeleton: true, organs: true } as const;

const part = (
  layer: PickablePart["layer"],
  system: PickablePart["system"],
  group: string | null = null,
): PickablePart => ({ layer, system, group, ontologyId: null });

const LIVER = part("organs", "digestive", "liver");
const PELVIS = part("skeleton", "musculoskeletal");
const BICEPS = part("muscle", "musculoskeletal");
const OUTLINE = { part: null };

describe("choosePick", () => {
  test("at the scan stop the body outline is what you click", () => {
    expect(choosePick([OUTLINE], 0, LAYERS, [])).toBe(0);
    // No atlas part draws at depth 0, even if a ray reached one.
    expect(choosePick([OUTLINE, { part: LIVER }], 0, LAYERS, [])).toBe(0);
  });

  test("at the organ stop a click looks through the glass outline and skeleton", () => {
    expect(choosePick([OUTLINE, { part: PELVIS }, { part: LIVER }], 3, LAYERS, [])).toBe(
      2,
    );
  });

  test("at the muscle stop the solid muscle in front wins", () => {
    expect(choosePick([OUTLINE, { part: BICEPS }, { part: PELVIS }], 1, LAYERS, [])).toBe(
      1,
    );
  });

  test("a half-faded outline still covers what is behind it", () => {
    expect(choosePick([OUTLINE, { part: BICEPS }], 0.3, LAYERS, [])).toBe(0);
  });

  test("hidden layers and systems are skipped", () => {
    const hits = [OUTLINE, { part: PELVIS }, { part: LIVER }];
    expect(choosePick(hits, 3, { ...LAYERS, organs: false }, [])).toBe(1);
    expect(choosePick(hits, 3, LAYERS, ["digestive"])).toBe(1);
  });

  test("with only glass under the pointer, the nearest visible part, then the outline", () => {
    expect(choosePick([OUTLINE, { part: PELVIS }], 3, LAYERS, [])).toBe(1);
    expect(choosePick([OUTLINE], 3, LAYERS, [])).toBe(0);
    expect(choosePick([], 3, LAYERS, [])).toBeNull();
  });
});

describe("isTap", () => {
  const down = { x: 100, y: 100, t: 0 };
  test("a short, still press is a tap", () => {
    expect(isTap(down, { x: 104, y: 104, t: 200 })).toBe(true);
    expect(isTap(down, { x: 106, y: 100, t: 500 })).toBe(true);
  });
  test("a drag or a long press is not", () => {
    expect(isTap(down, { x: 107, y: 100, t: 100 })).toBe(false);
    expect(isTap(down, { x: 100, y: 100, t: 501 })).toBe(false);
  });
});

describe("pickTarget and pickHighlight", () => {
  const groups = [{ key: "liver", label: "Liver" }];

  test("an HRA part is its organ group and lights that group", () => {
    const target = pickTarget({ ...LIVER, ontologyId: "UBERON:0002107" }, groups);
    expect(target).toEqual({
      kind: "part",
      label: "Liver",
      layer: "organs",
      system: "digestive",
      group: "liver",
      ontologyId: "UBERON:0002107",
    });
    expect(pickHighlight(target)).toEqual({ kind: "groups", ids: ["liver"] });
  });

  test("a BodyParts3D part is its system and lights the whole system", () => {
    const target = pickTarget(PELVIS, groups);
    expect(target).toEqual({
      kind: "part",
      label: "Musculoskeletal",
      layer: "skeleton",
      system: "musculoskeletal",
      group: null,
      ontologyId: null,
    });
    expect(pickHighlight(target)).toEqual({ kind: "system", ids: ["musculoskeletal"] });
  });

  test("an unassigned part lights nothing; the outline is the body", () => {
    expect(pickHighlight(pickTarget(part("organs", "unassigned"), []))).toBeNull();
    expect(pickTarget(null, groups)).toEqual({ kind: "body" });
    expect(pickHighlight({ kind: "body" })).toBeNull();
  });
});

describe("linkedRows", () => {
  const rows = markerRows(null);
  const ids = (target: Parameters<typeof linkedRows>[0], scheme: "hra" | "bodyparts3d") =>
    linkedRows(target, rows, scheme).map((row) => row.id);

  test("the HRA liver links the markers whose rows light the liver", () => {
    expect(ids(pickTarget(LIVER, []), "hra")).toEqual([
      "bm:BM-072",
      "bm:BM-140",
      "bm:BM-190",
      "bm:BM-200",
      "bm:BM-383",
      "bm:BM-123",
      "bm:BM-125",
      "bm:BM-130",
      "bm:BM-132",
      "bm:BM-346",
    ]);
  });

  test("BodyParts3D links by system; parts no row lights link nothing", () => {
    expect(ids(pickTarget(part("organs", "digestive"), []), "bodyparts3d")).toEqual([
      "bm:BM-064",
    ]);
    expect(ids(pickTarget(part("organs", "cardiovascular", "heart"), []), "hra")).toEqual(
      [],
    );
    expect(ids({ kind: "body" }, "hra")).toEqual([]);
  });
});

describe("pickHighlights", () => {
  test("an HRA pick lights its group on HRA and its whole system on BodyParts3D", () => {
    expect(pickHighlights(pickTarget(LIVER, []), "hra")).toEqual({
      hra: { kind: "groups", ids: ["liver"] },
      bodyparts3d: { kind: "system", ids: ["digestive"] },
    });
  });

  test("a BodyParts3D pick has no group to light on HRA", () => {
    expect(pickHighlights(pickTarget(PELVIS, []), "bodyparts3d")).toEqual({
      hra: null,
      bodyparts3d: { kind: "system", ids: ["musculoskeletal"] },
    });
  });

  test("unassigned parts and the body outline light nothing anywhere", () => {
    expect(pickHighlights(pickTarget(part("organs", "unassigned"), []), "hra")).toEqual({
      hra: null,
      bodyparts3d: null,
    });
    expect(pickHighlights({ kind: "body" }, "hra")).toEqual({
      hra: null,
      bodyparts3d: null,
    });
  });
});

describe("pickVisible", () => {
  const liver = pickTarget(LIVER, []);

  test("a part is visible while its layer draws and its toggles are on", () => {
    expect(pickVisible(liver, 3, LAYERS, [])).toBe(true);
    expect(pickVisible(pickTarget(PELVIS, []), 2, LAYERS, [])).toBe(true);
  });

  test("toggling its layer or system off hides it", () => {
    expect(pickVisible(liver, 3, { ...LAYERS, organs: false }, [])).toBe(false);
    expect(pickVisible(liver, 3, LAYERS, ["digestive"])).toBe(false);
    expect(pickVisible(liver, 3, LAYERS, ["nervous"])).toBe(true);
  });

  test("moving the slider past or before its layer hides it", () => {
    // Organs appear from depth 2; muscle is gone by the organ stop.
    expect(pickVisible(liver, 1, LAYERS, [])).toBe(false);
    expect(pickVisible(pickTarget(BICEPS, []), 3, LAYERS, [])).toBe(false);
    expect(pickVisible(pickTarget(BICEPS, []), 1, LAYERS, [])).toBe(true);
  });

  test("the body outline never goes away", () => {
    expect(
      pickVisible(
        { kind: "body" },
        3,
        { muscle: false, skeleton: false, organs: false },
        [],
      ),
    ).toBe(true);
  });
});
