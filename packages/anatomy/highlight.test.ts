import { describe, expect, test } from "bun:test";

import {
  groupLabel,
  litPartsHidden,
  partsFor,
  type HighlightablePart,
  type PartView,
} from "./highlight";

type Part = HighlightablePart & Readonly<{ id: string }>;

/** Synthetic parts shaped like a mixed atlas: HRA groups plus BodyParts3D-style systems. */
const PARTS: readonly Part[] = [
  { id: "liver", group: "liver", system: "metabolic" },
  { id: "liver-ducts", group: "liverducts", system: "metabolic" },
  { id: "heart", group: "heart", system: "cardiovascular" },
  { id: "vertebrae", group: "vertebrae", system: "musculoskeletal" },
  { id: "bp3d-muscle", group: null, system: "musculoskeletal" },
  { id: "bp3d-bone", group: null, system: "musculoskeletal" },
  { id: "lymph", group: "lymphnode", system: "unassigned" },
];

const ids = (parts: readonly Part[]): readonly string[] => parts.map((part) => part.id);

describe("partsFor", () => {
  test("groups match the normalised key only", () => {
    expect(ids(partsFor({ kind: "groups", ids: ["liver"] }, PARTS))).toEqual(["liver"]);
    expect(
      ids(partsFor({ kind: "groups", ids: ["liver", "liverducts"] }, PARTS)),
    ).toEqual(["liver", "liver-ducts"]);
  });

  test("raw HRA keys are normalised before matching", () => {
    expect(ids(partsFor({ kind: "groups", ids: ["#VHMHeartV1.1"] }, PARTS))).toEqual([
      "heart",
    ]);
  });

  test("a system lights every layer it has, muscle and bone included", () => {
    expect(ids(partsFor({ kind: "system", ids: ["musculoskeletal"] }, PARTS))).toEqual([
      "vertebrae",
      "bp3d-muscle",
      "bp3d-bone",
    ]);
  });

  test("empty or unknown ids light nothing; parts without a group never match", () => {
    expect(partsFor({ kind: "groups", ids: [] }, PARTS)).toEqual([]);
    expect(partsFor({ kind: "system", ids: [] }, PARTS)).toEqual([]);
    expect(partsFor({ kind: "groups", ids: ["thyroid"] }, PARTS)).toEqual([]);
    expect(partsFor({ kind: "groups", ids: [""] }, PARTS)).toEqual([]);
  });
});

describe("groupLabel", () => {
  test("reads the HRA key as words", () => {
    expect(groupLabel("#VHFLiver")).toBe("Liver");
    expect(groupLabel("#VHFSmallIntestine")).toBe("Small intestine");
    expect(groupLabel("#VHMBloodVasculature")).toBe("Blood vasculature");
    expect(groupLabel("#VHFHeartV1.1")).toBe("Heart");
    expect(groupLabel("#VHFLeftKidneyV1.1")).toBe("Kidney");
    expect(groupLabel("#VHFKneeLigamentsLeft")).toBe("Knee ligaments");
    expect(groupLabel("##VHFEpiploicAppendageOfTransverseColon")).toBe(
      "Epiploic appendage of transverse colon",
    );
  });
  test("left and right go whatever their case; both atlases read organ first", () => {
    expect(groupLabel("#VHFleftKidney")).toBe("Kidney");
    expect(groupLabel("#VHMrightUreter")).toBe("Ureter");
    expect(groupLabel("#VHMDuctsLiver")).toBe("Liver ducts");
    expect(groupLabel("#VHFLiverDucts")).toBe("Liver ducts");
    expect(groupLabel("#VHMLigamentsKnee")).toBe("Knee ligaments");
    expect(groupLabel("#VHMMusclesEye")).toBe("Eye muscles");
    expect(groupLabel("#VHFLigamentsUterusOvaries")).toBe("Ligaments uterus ovaries");
  });

  test("left and right go only as whole words", () => {
    expect(groupLabel("#VHFCleftPalate")).toBe("Cleft palate");
    expect(groupLabel("#VHMBrightTissue")).toBe("Bright tissue");
    expect(groupLabel("#VHFLeftKidneyV1.1")).toBe("Kidney");
    expect(groupLabel("#VHFKneeLigamentsLeft")).toBe("Knee ligaments");
  });
});

describe("litPartsHidden", () => {
  const VIEWS: readonly PartView[] = [
    { layer: "organs", system: "metabolic", group: "liver" },
    { layer: "organs", system: "metabolic", group: "gallbladder" },
    { layer: "skeleton", system: "musculoskeletal", group: "vertebrae" },
  ];
  const ALL_LAYERS = { muscle: true, skeleton: true, organs: true };
  const liver = { kind: "groups", ids: ["liver", "gallbladder"] } as const;

  test("only when every lit part is hidden by a toggle", () => {
    expect(litPartsHidden(liver, VIEWS, ALL_LAYERS, [])).toBe(false);
    expect(litPartsHidden(liver, VIEWS, { ...ALL_LAYERS, organs: false }, [])).toBe(true);
    expect(litPartsHidden(liver, VIEWS, ALL_LAYERS, ["metabolic"])).toBe(true);
  });

  test("a system chip hides organs only; muscle and bone keep their own checkbox", () => {
    const bone = { kind: "system", ids: ["musculoskeletal"] } as const;
    expect(litPartsHidden(bone, VIEWS, ALL_LAYERS, ["musculoskeletal"])).toBe(false);
    expect(litPartsHidden(bone, VIEWS, { ...ALL_LAYERS, skeleton: false }, [])).toBe(
      true,
    );
  });

  test("nothing lit is not hidden: no highlight, or a group this atlas lacks", () => {
    expect(litPartsHidden(null, VIEWS, { ...ALL_LAYERS, organs: false }, [])).toBe(false);
    expect(
      litPartsHidden({ kind: "groups", ids: ["prostate"] }, VIEWS, ALL_LAYERS, []),
    ).toBe(false);
  });
});
