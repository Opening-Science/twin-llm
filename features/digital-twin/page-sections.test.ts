import { describe, expect, test } from "bun:test";

import { sourceLines, twinSections, type TwinContext } from "./page-sections";

const demoCohort: TwinContext = {
  subject: "demo",
  scans: 0,
  biomarkerValues: 24,
  biomarkersStatus: "ok",
  liveVitals: true,
};
const demoNoCohort: TwinContext = {
  subject: "demo",
  scans: 0,
  biomarkerValues: 0,
  biomarkersStatus: "ok",
  liveVitals: false,
};
const selfScans: TwinContext = {
  subject: "self",
  scans: 3,
  biomarkerValues: 5,
  biomarkersStatus: "ok",
  liveVitals: true,
};
const selfNoScans: TwinContext = {
  subject: "self",
  scans: 0,
  biomarkerValues: 5,
  biomarkersStatus: "ok",
  liveVitals: true,
};
const otherScans: TwinContext = {
  subject: "other",
  scans: 2,
  biomarkerValues: 0,
  biomarkersStatus: "ok",
  liveVitals: false,
};

const lines = (context: TwinContext) =>
  sourceLines(context, twinSections({ context, genomeEnabled: false }).empty);

describe("twinSections", () => {
  test("before the viewer knows its subject there is no Sources section", () => {
    expect(twinSections({ context: null, genomeEnabled: false })).toEqual({
      sections: ["body", "genome"],
      empty: ["genome"],
    });
    expect(twinSections({ context: null, genomeEnabled: true })).toEqual({
      sections: ["body", "genome"],
      empty: [],
    });
  });

  test("Demo with cohort labs: nothing empty but the genome", () => {
    expect(twinSections({ context: demoCohort, genomeEnabled: false })).toEqual({
      sections: ["body", "sources", "genome"],
      empty: ["genome"],
    });
  });

  test("Demo without a cohort: no scans is never an empty state, labs and vitals are", () => {
    expect(twinSections({ context: demoNoCohort, genomeEnabled: true })).toEqual({
      sections: ["body", "sources", "genome"],
      empty: ["biomarkers", "vitals"],
    });
  });

  test("Self with scans and wearables: nothing empty", () => {
    expect(twinSections({ context: selfScans, genomeEnabled: true })).toEqual({
      sections: ["body", "sources", "genome"],
      empty: [],
    });
  });

  test("Self without scans says so", () => {
    expect(twinSections({ context: selfNoScans, genomeEnabled: true })).toEqual({
      sections: ["body", "sources", "genome"],
      empty: ["scans"],
    });
  });

  test("another subject has no labs or vitals", () => {
    expect(twinSections({ context: otherScans, genomeEnabled: true })).toEqual({
      sections: ["body", "sources", "genome"],
      empty: ["biomarkers", "vitals"],
    });
  });
});

describe("biomarkers still loading or failed", () => {
  const demoLoading: TwinContext = { ...demoNoCohort, biomarkersStatus: "loading" };
  const demoFailed: TwinContext = { ...demoNoCohort, biomarkersStatus: "failed" };

  test("loading is not an empty state: the line names the source", () => {
    expect(twinSections({ context: demoLoading, genomeEnabled: true }).empty).toEqual([
      "vitals",
    ]);
    expect(lines(demoLoading)[1]).toEqual({
      label: "Biomarkers",
      text: "Lab values of a synthetic cohort person, not of this body.",
    });
  });

  test("a failed read says so, never that there are no values", () => {
    expect(twinSections({ context: demoFailed, genomeEnabled: true }).empty).toEqual([
      "vitals",
    ]);
    expect(lines(demoFailed)[1]).toEqual({
      label: "Biomarkers",
      text: "Could not load biomarker values.",
    });
  });
});

describe("sourceLines", () => {
  test("Demo with cohort labs", () => {
    expect(lines(demoCohort)).toEqual([
      { label: "Body", text: "Synthetic ANNY body, not a person." },
      {
        label: "Biomarkers",
        text: "Lab values of a synthetic cohort person, not of this body.",
      },
      { label: "Live vitals", text: "Vitals of a synthetic cohort person." },
    ]);
  });

  test("Demo without a cohort", () => {
    expect(lines(demoNoCohort)).toEqual([
      { label: "Body", text: "Synthetic ANNY body, not a person." },
      { label: "Biomarkers", text: "No biomarker values for this subject." },
      { label: "Live vitals", text: "No vitals for this subject." },
    ]);
  });

  test("Self with and without scans", () => {
    expect(lines(selfScans)).toEqual([
      { label: "Body", text: "BodyLoop scans of this subject." },
      { label: "Biomarkers", text: "Your connected wearables." },
      { label: "Live vitals", text: "Your connected wearables." },
    ]);
    expect(lines(selfNoScans)[0]).toEqual({
      label: "Body",
      text: "No scans for this subject yet.",
    });
  });

  test("another subject", () => {
    expect(lines(otherScans)).toEqual([
      { label: "Body", text: "BodyLoop scans of this subject." },
      { label: "Biomarkers", text: "No biomarker values for this subject." },
      { label: "Live vitals", text: "No vitals for this subject." },
    ]);
  });
});
