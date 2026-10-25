import { describe, expect, test } from "bun:test";

import {
  classifyAtlasNode,
  classifyBodyParts3dNode,
  classifyHraNode,
} from "./atlas-nodes";
import { normaliseGroup } from "./hra-groups";

describe("classifyBodyParts3dNode", () => {
  test.each([
    [
      { system: "musculoskeletal", layer: "muscle" },
      { kind: "layer", layer: "muscle", system: "musculoskeletal" },
    ],
    [
      { system: "musculoskeletal", layer: "bone" },
      { kind: "layer", layer: "skeleton", system: "musculoskeletal" },
    ],
    [
      { system: "musculoskeletal", layer: "connective" },
      { kind: "layer", layer: "skeleton", system: "musculoskeletal" },
    ],
    [
      { system: "cardiovascular", layer: "organ" },
      { kind: "layer", layer: "organs", system: "cardiovascular" },
    ],
    [{ system: "integumentary", layer: "organ" }, { kind: "hull" }],
    [
      { system: "lymphoid", layer: "organ" },
      { kind: "layer", layer: "organs", system: "unassigned" },
    ],
    [{}, { kind: "layer", layer: "organs", system: "unassigned" }],
  ])("%o", (extras, expected) => {
    expect(classifyBodyParts3dNode(extras)).toEqual(expected);
  });
});

describe("classifyHraNode", () => {
  test.each([
    [
      "#VHFLiver",
      "VH_F_liver",
      undefined,
      { kind: "layer", layer: "organs", system: "metabolic" },
    ],
    [
      "#VHMHeart",
      "VH_M_heart",
      undefined,
      { kind: "layer", layer: "organs", system: "cardiovascular" },
    ],
    ["#VHFSkinV1.2", "VH_F_skin", undefined, { kind: "hull" }],
    ["#VHFPlacentaFullTerm", "VH_F_placenta", undefined, { kind: "hidden" }],
    [
      "#VHMMusclesLeftKnee",
      "#VHMMusclesLeftKnee",
      undefined,
      { kind: "layer", layer: "muscle", system: "musculoskeletal" },
    ],
    [
      "#VHFKneeLigamentsRight",
      "#VHFKneeLigamentsRight",
      undefined,
      { kind: "layer", layer: "skeleton", system: "musculoskeletal" },
    ],
    [
      "#VHFPelvis",
      "#VHFPelvis",
      undefined,
      { kind: "layer", layer: "skeleton", system: "musculoskeletal" },
    ],
    ["-", "VH_F_left_superomedial_segment1", undefined, { kind: "hidden" }],
    [
      "-",
      "VH_F_minor_calyx_3",
      "UBERON:0001227",
      { kind: "layer", layer: "organs", system: "metabolic" },
    ],
    [
      "-",
      "VH_M_vas_deferens_L",
      "UBERON:0001000",
      { kind: "layer", layer: "organs", system: "unassigned" },
    ],
    [
      "#VHFLymphNode",
      "VH_F_lymph_node",
      undefined,
      { kind: "layer", layer: "organs", system: "unassigned" },
    ],
  ])("%s / %s", (group, name, term, expected) => {
    const extras =
      term === undefined
        ? { anatomical_structure_of: group }
        : { anatomical_structure_of: group, ontologyid: term };
    expect(classifyHraNode(extras, name)).toEqual(expected);
  });

  test("normaliseGroup strips prefix, version, laterality and doubled #", () => {
    expect(normaliseGroup("#VHMHeartV1.1")).toBe("heart");
    expect(normaliseGroup("#VHFLeftKidneyV1.1")).toBe("kidney");
    expect(normaliseGroup("##VHFEpiploicAppendageOfTransverseColon")).toBe(
      "epiploicappendageoftransversecolon",
    );
  });
});

describe("classifyAtlasNode", () => {
  test("routes by scheme", () => {
    expect(
      classifyAtlasNode("bodyparts3d", { system: "nervous", layer: "organ" }, "x"),
    ).toEqual({
      kind: "layer",
      layer: "organs",
      system: "nervous",
    });
    expect(
      classifyAtlasNode("hra", { anatomical_structure_of: "#VHFBrain" }, "x"),
    ).toEqual({
      kind: "layer",
      layer: "organs",
      system: "nervous",
    });
  });
});
