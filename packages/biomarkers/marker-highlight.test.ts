import { describe, expect, test } from "bun:test";

import { biomarkerById } from "./catalogue";
import { markerHighlight, NOT_IN_ATLAS, vitalHighlight } from "./marker-highlight";
import {
  GLAND_NOT_MODELLED,
  markerAnatomy,
  MUSCLE_NOT_MODELLED,
  NO_SINGLE_LOCATION,
} from "./region-anatomy";
import { VITAL_ANATOMY } from "./vitals";

const lit = (id: string, scheme: "hra" | "bodyparts3d") =>
  markerHighlight(markerAnatomy(biomarkerById(id)!), scheme);

describe("markerHighlight", () => {
  test("GGT lights liver and gallbladder groups on HRA, the metabolic system on BodyParts3D", () => {
    expect(lit("BM-123", "hra")).toEqual({
      highlight: {
        kind: "groups",
        ids: [
          "liver",
          "liverducts",
          "ductsliver",
          "gallbladder",
          "gallbladderducts",
          "ductsgallbladder",
        ],
      },
    });
    expect(lit("BM-123", "bodyparts3d")).toEqual({
      highlight: { kind: "system", ids: ["metabolic"] },
    });
  });

  test("total cholesterol lights two systems on BodyParts3D, no system twice", () => {
    expect(lit("BM-072", "bodyparts3d")).toEqual({
      highlight: { kind: "system", ids: ["cardiovascular", "metabolic"] },
    });
  });

  test("glands and CK: whole system with its note on BodyParts3D, nothing on HRA", () => {
    expect(lit("BM-386", "bodyparts3d")).toEqual({
      highlight: { kind: "system", ids: ["endocrine"] },
      note: GLAND_NOT_MODELLED,
    });
    expect(lit("BM-386", "hra")).toEqual({ highlight: null, note: NOT_IN_ATLAS });
    expect(lit("BM-078", "bodyparts3d")).toEqual({
      highlight: { kind: "system", ids: ["musculoskeletal"] },
      note: MUSCLE_NOT_MODELLED,
    });
    expect(lit("BM-078", "hra")).toEqual({ highlight: null, note: NOT_IN_ATLAS });
  });

  test("PTH on HRA lights the bone groups its bone region has", () => {
    expect(lit("BM-299", "hra")).toEqual({
      highlight: {
        kind: "groups",
        ids: ["vertebrae", "pelvis", "sternum", "manubrium", "knee"],
      },
    });
  });

  test("no single body location lights nothing on either atlas", () => {
    for (const id of ["BM-107", "BM-436", "BM-139"]) {
      expect(lit(id, "hra")).toEqual({ highlight: null, note: NO_SINGLE_LOCATION });
      expect(lit(id, "bodyparts3d")).toEqual({
        highlight: null,
        note: NO_SINGLE_LOCATION,
      });
    }
  });
});

describe("vitalHighlight", () => {
  test("HRA lights the vital's groups; BodyParts3D and group-less vitals light the system", () => {
    expect(vitalHighlight(VITAL_ANATOMY.heartRate, "hra")).toEqual({
      highlight: { kind: "groups", ids: ["heart"] },
    });
    expect(vitalHighlight(VITAL_ANATOMY.respiration, "hra")).toEqual({
      highlight: { kind: "groups", ids: ["lung", "trachea"] },
    });
    expect(vitalHighlight(VITAL_ANATOMY.hrv, "bodyparts3d")).toEqual({
      highlight: { kind: "system", ids: ["nervous"] },
    });
    expect(vitalHighlight(VITAL_ANATOMY.strain, "hra")).toEqual({
      highlight: { kind: "system", ids: ["cardiovascular"] },
    });
  });
});
