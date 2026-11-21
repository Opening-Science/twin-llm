import { describe, expect, test } from "bun:test";

import {
  provenanceIssues,
  replayEventSchema,
  replayNarrationSchema,
  replayReadingSchema,
} from "./items";

const SCOPE = {
  subject_ref: "synthetic-replay-a",
  day: "2026-10-20",
  time_zone: "Europe/Berlin",
  origin: "synthetic_demo",
} as const;

const heart = {
  ...SCOPE,
  id: "hr-0800",
  stream: "heart_rate",
  unit: "/min",
  at: "2026-10-20T06:00:00Z",
  interval_min: 15,
  provenance: "measured",
  source: { kind: "device", name: "Synthetic ring" },
  availability: "available",
  value: 62,
} as const;

const issues = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []));

describe("readings", () => {
  test("a measured heart rate with its device, unit and instant parses", () => {
    expect(replayReadingSchema.safeParse(heart).success).toBe(true);
  });

  test("each stream has one unit: heart rate in mg/dL is refused", () => {
    expect(replayReadingSchema.safeParse({ ...heart, unit: "mg/dL" }).success).toBe(
      false,
    );
  });

  test("a nightly HRV is in ms and stands for the night", () => {
    const hrv = {
      ...heart,
      id: "hrv-night",
      stream: "hrv_rmssd",
      unit: "ms",
      at: "2026-10-20T05:30:00Z",
      interval_min: 450,
      value: 58,
    };
    expect(replayReadingSchema.safeParse(hrv).success).toBe(true);
    expect(replayReadingSchema.safeParse({ ...hrv, unit: "/min" }).success).toBe(false);
  });

  test("a glucose reading names blood or sensor", () => {
    const glucose = {
      ...heart,
      id: "g-0800",
      stream: "glucose",
      unit: "mg/dL",
      value: 96,
    };
    expect(replayReadingSchema.safeParse(glucose).success).toBe(false);
    expect(
      replayReadingSchema.safeParse({ ...glucose, specimen: "sensor" }).success,
    ).toBe(true);
  });

  test("insulin is not a reading stream, in any provenance", () => {
    for (const provenance of ["measured", "derived", "entered"]) {
      expect(
        replayReadingSchema.safeParse({
          ...heart,
          stream: "insulin",
          unit: "µU/mL",
          provenance,
        }).success,
      ).toBe(false);
    }
  });

  test("a narrated reading does not exist: readings are measured, derived or entered", () => {
    expect(
      replayReadingSchema.safeParse({
        ...heart,
        provenance: "narrated",
        source: { kind: "twin_llm", name: "TwinLLM" },
      }).success,
    ).toBe(false);
  });

  test("a missing reading has no value and says why; it is never filled in", () => {
    const missing = {
      ...heart,
      availability: "missing",
      value: null,
      missing_reason: "Ring off the finger",
    };
    expect(replayReadingSchema.safeParse(missing).success).toBe(true);
    expect(issues(replayReadingSchema.safeParse({ ...missing, value: 62 }))).toContain(
      "a missing reading has no value; never fill one in",
    );
    expect(
      issues(replayReadingSchema.safeParse({ ...missing, missing_reason: undefined })),
    ).toContain("a missing reading says why");
    expect(issues(replayReadingSchema.safeParse({ ...heart, value: null }))).toContain(
      "an available reading has a value",
    );
  });

  test("an instant must be UTC, and the day and zone must be real", () => {
    expect(
      replayReadingSchema.safeParse({ ...heart, at: "2026-10-20T08:00:00+02:00" })
        .success,
    ).toBe(false);
    expect(replayReadingSchema.safeParse({ ...heart, day: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      replayReadingSchema.safeParse({ ...heart, time_zone: "Mars/Olympus" }).success,
    ).toBe(false);
  });
});

describe("the provenance rule", () => {
  test("measured names a device, entered the person, derived and narrated TwinLLM", () => {
    expect(
      provenanceIssues({ provenance: "measured", source: { kind: "person" } }),
    ).toEqual(["measured items name a device source"]);
    expect(
      provenanceIssues({ provenance: "entered", source: { kind: "device" } }),
    ).toEqual(["entered items name a person source"]);
    expect(
      provenanceIssues({ provenance: "measured", source: { kind: "device" } }),
    ).toEqual([]);
  });

  test("a derived value names its rule and the items it used; nothing else does", () => {
    const derived = {
      ...heart,
      provenance: "derived",
      source: { kind: "twin_llm", name: "TwinLLM" },
    };
    expect(issues(replayReadingSchema.safeParse(derived))).toContain(
      "a derived item names its rule and the items it used",
    );
    expect(
      replayReadingSchema.safeParse({
        ...derived,
        rule: { id: "peak", text: "The highest heart rate in the window." },
        evidence: ["hr-0745", "hr-0800"],
      }).success,
    ).toBe(true);
    expect(
      issues(
        replayReadingSchema.safeParse({
          ...heart,
          rule: { id: "peak", text: "The highest heart rate in the window." },
        }),
      ),
    ).toContain("only a derived item names a rule and evidence");
  });
});

describe("events", () => {
  const breakfast = {
    ...SCOPE,
    id: "tag-breakfast",
    kind: "meal",
    meal: "breakfast",
    label: "Breakfast",
    from: "2026-10-20T05:30:00Z",
    to: "2026-10-20T05:50:00Z",
    provenance: "entered",
    source: { kind: "person", name: "Tag entered by the person" },
  } as const;

  test("an entered meal tag parses", () => {
    expect(replayEventSchema.safeParse(breakfast).success).toBe(true);
  });

  test("a meal names its meal and an activity its activity", () => {
    expect(replayEventSchema.safeParse({ ...breakfast, meal: undefined }).success).toBe(
      false,
    );
    expect(
      replayEventSchema.safeParse({
        ...breakfast,
        kind: "activity",
        meal: undefined,
        provenance: "measured",
        source: { kind: "device", name: "Synthetic ring" },
      }).success,
    ).toBe(false);
  });

  test("a meal or a tag is what the person entered, never a device's", () => {
    for (const event of [breakfast, { ...breakfast, kind: "tag", meal: undefined }]) {
      expect(
        issues(
          replayEventSchema.safeParse({
            ...event,
            provenance: "measured",
            source: { kind: "device", name: "Synthetic ring" },
          }),
        ),
      ).toEqual(["a meal or a tag is entered by the person"]);
    }
  });

  test("an event cannot end before it starts", () => {
    expect(
      replayEventSchema.safeParse({ ...breakfast, to: "2026-10-20T05:00:00Z" }).success,
    ).toBe(false);
  });
});

describe("narration", () => {
  const insulin = {
    ...SCOPE,
    id: "n-insulin-breakfast",
    provenance: "narrated",
    source: { kind: "twin_llm", name: "TwinLLM" },
    topic: "insulin",
    text: "After a meal the pancreas usually releases insulin, which helps cells take up sugar. Not measured.",
    focus: "pancreas",
    from: "2026-10-20T05:45:00Z",
    to: "2026-10-20T06:30:00Z",
  } as const;

  test("insulin narration parses", () => {
    expect(replayNarrationSchema.safeParse(insulin).success).toBe(true);
  });

  test("narration carries no value and no number in its words", () => {
    expect(replayNarrationSchema.safeParse({ ...insulin, value: 12 }).success).toBe(
      false,
    );
    expect(
      replayNarrationSchema.safeParse({
        ...insulin,
        text: "The pancreas releases about 4 units of insulin.",
      }).success,
    ).toBe(false);
  });

  test("narration is only ever narrated and only from TwinLLM", () => {
    expect(
      replayNarrationSchema.safeParse({ ...insulin, provenance: "measured" }).success,
    ).toBe(false);
    expect(
      replayNarrationSchema.safeParse({
        ...insulin,
        source: { kind: "device", name: "Synthetic pump" },
      }).success,
    ).toBe(false);
  });
});
