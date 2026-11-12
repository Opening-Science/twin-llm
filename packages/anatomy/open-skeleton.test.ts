import { describe, expect, test } from "bun:test";

import {
  isExcluded,
  isModelled,
  leftOutName,
  leftOutSummary,
  matchKey,
  parseSkeletonAtlas,
  readSkeletonNode,
  skeletonFromAtlasJson,
} from "./open-skeleton";

/** The shape open-anatomy's Stage 1 writes (scripts/atlas.py), trimmed. */
const STAGE_1 = {
  case: "s0086",
  record: { sex: "m", age: 71, typical: true },
  scope:
    "Stage 1, thorax only: ribs, costal cartilages and arch, sternum, and the spine as far as the scan has it. The shoulder girdle is not part of Stage 1.",
  girdleLeftOut: [
    {
      label: "clavicula_left",
      reason: "cut by the scan's edge (unscanned padding)",
      cut_at: "S",
    },
    {
      label: "clavicula_right",
      reason: "cut by the scan's edge (unscanned padding)",
      cut_at: "S",
    },
    {
      label: "scapula_left",
      reason: "cut by the scan's edge (unscanned padding)",
      cut_at: "S",
    },
    {
      label: "scapula_right",
      reason: "cut by the scan's edge (unscanned padding)",
      cut_at: "S",
    },
    { label: "humerus_left", reason: "cut by the scan's edge (unscanned padding)" },
    { label: "humerus_right", reason: "cut by the scan's edge (unscanned padding)" },
  ],
  skeleton: "data/atlas/s0086/s0086.skeleton.glb",
};

/** GLB node extras as open-anatomy's mesh.py writes them. */
const STERNUM = readSkeletonNode("FMA_7485", {
  term: "FMA:7485",
  name: "sternum",
  system: "skeletal",
  licence: "CC-BY-4.0",
});
const CARTILAGES = readSkeletonNode("FMA_85213", {
  term: "FMA:85213",
  name: "set of costal cartilages",
  system: "skeletal",
  licence: "CC-BY-4.0",
  modelled: true,
});

describe("parseSkeletonAtlas", () => {
  test("reads Stage 1's atlas.json: case, scope and the girdle it left out", () => {
    const atlas = parseSkeletonAtlas(STAGE_1);
    expect(atlas.caseId).toBe("s0086");
    expect(atlas.scope).toBe(STAGE_1.scope);
    expect(atlas.attribution).toBeNull();
    expect(atlas.excluded.map((entry) => entry.label)).toEqual([
      "clavicula_left",
      "clavicula_right",
      "scapula_left",
      "scapula_right",
      "humerus_left",
      "humerus_right",
    ]);
    expect(atlas.excluded[0]!.reason).toBe("cut by the scan's edge (unscanned padding)");
    expect(atlas.modelled).toEqual([]);
  });

  test("the first atlas.json, with no scope or left-out list, still parses", () => {
    expect(parseSkeletonAtlas({ case: "s0086", renders: [] })).toEqual({
      caseId: "s0086",
      scope: null,
      attribution: null,
      excluded: [],
      modelled: [],
    });
  });

  test("an `excluded` list joins the girdle list, once per structure", () => {
    const atlas = parseSkeletonAtlas({
      excluded: ["Left clavicle", { term: "FMA:13321", reason: "not segmented" }, 7],
      girdleLeftOut: [{ label: "clavicula_left" }, { label: "left_clavicle" }],
    });
    expect(atlas.excluded).toEqual([
      { label: "Left clavicle", reason: null },
      { label: "FMA:13321", reason: "not segmented" },
    ]);
  });

  test("modelled comes from a list or from node rows", () => {
    const atlas = parseSkeletonAtlas({
      modelled: ["FMA:85213", "inferred rib head"],
      nodes: [
        { name: "FMA_7485", modelled: false },
        { name: "FMA_9165", modelled: true },
      ],
    });
    expect(atlas.modelled).toEqual(["FMA:85213", "inferred rib head", "FMA_9165"]);
  });

  test("anything that is not an object is an empty atlas", () => {
    expect(parseSkeletonAtlas(null)).toEqual(parseSkeletonAtlas({}));
    expect(parseSkeletonAtlas("s0086").caseId).toBeNull();
  });
});

describe("readSkeletonNode", () => {
  test("names a bone from its extras, first letter capitalised", () => {
    expect(STERNUM).toEqual({
      name: "FMA_7485",
      term: "FMA:7485",
      label: "Sternum",
      modelled: false,
      explode: null,
    });
  });

  test("the explode contract's `label` wins over `name`, and its explode is read", () => {
    const node = readSkeletonNode("UBERON_0002107", {
      label: "liver",
      name: "ignored",
      explode: { direction: [0, 0, 1], distance: 0.13 },
    });
    expect(node.label).toBe("Liver");
    expect(node.explode).toEqual({ direction: [0, 0, 1], distance: 0.13 });
  });

  test("a node without extras falls back to its name", () => {
    expect(readSkeletonNode("FMA_9165", {}).label).toBe("FMA_9165");
  });
});

describe("excluded and modelled", () => {
  const atlas = parseSkeletonAtlas(STAGE_1);

  test("a bone atlas.json left out is excluded by its Latin label's English name", () => {
    const clavicle = readSkeletonNode("FMA_13322", {
      term: "FMA:13322",
      name: "left clavicle",
    });
    expect(isExcluded(clavicle, atlas)).toBe(true);
    expect(isExcluded(STERNUM, atlas)).toBe(false);
  });

  test("an excluded term or node name matches either spelling", () => {
    const byTerm = parseSkeletonAtlas({ excluded: ["FMA:13322"] });
    const node = readSkeletonNode("FMA_13322", {});
    expect(isExcluded(node, byTerm)).toBe(true);
  });

  test("modelled from the node's extras or from atlas.json", () => {
    expect(isModelled(CARTILAGES, atlas)).toBe(true);
    expect(isModelled(STERNUM, atlas)).toBe(false);
    expect(isModelled(STERNUM, parseSkeletonAtlas({ modelled: ["FMA:7485"] }))).toBe(
      true,
    );
    expect(isModelled(STERNUM, parseSkeletonAtlas({ modelled: ["sternum"] }))).toBe(true);
  });
});

describe("left-out wording", () => {
  test("Latin labels read as English", () => {
    expect(leftOutName("clavicula_left")).toBe("left clavicle");
    expect(leftOutName("humerus_right")).toBe("right humerus");
    expect(leftOutName("sternum")).toBe("sternum");
  });

  test("both sides read as the plural, one side as itself", () => {
    expect(leftOutSummary(parseSkeletonAtlas(STAGE_1).excluded)).toBe(
      "clavicles, scapulae and humeri",
    );
    expect(
      leftOutSummary([
        { label: "humerus_left", reason: null },
        { label: "clavicula_left", reason: null },
        { label: "clavicula_right", reason: null },
      ]),
    ).toBe("left humerus and clavicles");
    expect(leftOutSummary([])).toBe("");
  });

  test("matchKey joins ids, terms and names", () => {
    expect(matchKey("FMA:7485")).toBe(matchKey("FMA_7485"));
    expect(matchKey("Left clavicle")).toBe("left_clavicle");
  });
});

describe("skeletonFromAtlasJson fails closed", () => {
  test("a missing atlas.json shows no CT skeleton and says so", () => {
    expect(skeletonFromAtlasJson(null, "s0086")).toEqual({
      skeleton: null,
      problem: "atlas-missing",
    });
  });

  test("an atlas.json that is not a JSON object shows no CT skeleton", () => {
    for (const raw of ["{", "[]", "null", '"s0086"']) {
      expect(skeletonFromAtlasJson(raw, "s0086")).toEqual({
        skeleton: null,
        problem: "atlas-invalid",
      });
    }
  });

  test("a readable atlas.json gives the skeleton, the case from the file name if needed", () => {
    expect(skeletonFromAtlasJson(JSON.stringify(STAGE_1), null).skeleton?.caseId).toBe(
      "s0086",
    );
    const status = skeletonFromAtlasJson("{}", "s0197");
    expect(status.problem).toBeNull();
    expect(status.skeleton?.caseId).toBe("s0197");
  });
});
