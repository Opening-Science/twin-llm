import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type CitationRow = readonly [string, string, string | number, string | undefined];

const metricsFromRows = (rows: readonly CitationRow[]) =>
  rows.map(([citation, label, value, unit]) =>
    Object.assign(
      { label, value, date: "2026-07-10" },
      Object.fromEntries([["key", citation]]),
      unit === undefined ? {} : { unit },
    ),
  );

describe("buildTwinSystemPrompt BodyLoop keys", () => {
  test("passes only numeric vitronic.* keys with units; never positions, contours, or mesh", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const prompt = buildTwinSystemPrompt({
      mode: "personal",
      oura: null,
      whoop: null,
      googleHealth: null,
      vitronic: {
        window: { startDate: "2026-07-10", endDate: "2026-07-10" },
        narrative: "stored narrative with a mesh dump and contour list",
        metrics: metricsFromRows([
          [
            "vitronic.property.body.height.2026-07-10",
            "BodyLoop body.height (2026-07-10)",
            1.7,
            "m",
          ],
          [
            "vitronic.height.vertex.2026-07-10",
            "BodyLoop height vertex (2026-07-10)",
            0.92,
            "m",
          ],
          ["vitronic.positions.leftHip.2026-07-10", "left hip position", 0.12, "m"],
          ["vitronic.contours.waist.2026-07-10", "waist contour", 80, "cm"],
          ["vitronic.mesh.vertexCount.2026-07-10", "mesh vertex count", 12000, "count"],
          [
            "vitronic.property.body.mass.2026-07-10",
            "BodyLoop body.mass (2026-07-10)",
            68,
            undefined,
          ],
          ["oura.sleep.duration.2026-07-10", "not a BodyLoop key", 7, "h"],
          [
            "vitronic.property.body.surface.2026-07-10",
            "BodyLoop body.surface (2026-07-10)",
            "1.85",
            "m2",
          ],
        ]),
      },
    });

    const bodyLoopSection = prompt.slice(
      prompt.indexOf("## Wearable context (BodyLoop)"),
    );
    expect(bodyLoopSection).toContain("[vitronic.property.body.height.2026-07-10]");
    expect(bodyLoopSection).toContain("1.7 m");
    expect(bodyLoopSection).toContain("[vitronic.height.vertex.2026-07-10]");
    expect(bodyLoopSection).toContain("92.0 cm");
    expect(bodyLoopSection).not.toMatch(/position/i);
    expect(bodyLoopSection).not.toMatch(/contour/i);
    expect(bodyLoopSection).not.toMatch(/mesh/i);
    expect(bodyLoopSection).not.toContain("vitronic.property.body.mass");
    expect(bodyLoopSection).not.toContain("oura.sleep.duration");
    expect(bodyLoopSection).not.toContain("1.85");
    expect(bodyLoopSection).not.toContain("stored narrative");
  });
});

describe("buildTwinSystemPrompt key lists match offeredKeys", () => {
  test("the [key] lines in the prompt are exactly offeredKeys() for the same snapshot", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const { offeredKeys } = await import("@/infrastructure/offered-keys");
    const window = { startDate: "2026-07-10", endDate: "2026-07-10" };
    const summaries = {
      oura: {
        window,
        narrative: "Synthetic Oura window.",
        metrics: Array.from({ length: 45 }, (_, index) => ({
          key: `oura.synthetic.m${index + 1}.2026-07-10`,
          label: `Synthetic metric ${index + 1}`,
          value: index + 1,
        })),
      },
      whoop: {
        window,
        narrative: "Synthetic Whoop window.",
        metrics: [
          { key: "whoop.recovery.score.2026-07-10", label: "Recovery", value: 64 },
        ],
      },
      googleHealth: null,
      vitronic: {
        window,
        narrative: "Synthetic scan.",
        metrics: metricsFromRows([
          [
            "vitronic.property.body.height.2026-07-10",
            "BodyLoop body.height (2026-07-10)",
            1.7,
            "m",
          ],
          ["vitronic.positions.leftHip.2026-07-10", "left hip position", 0.12, "m"],
        ]),
      },
    };

    const prompt = buildTwinSystemPrompt({ ...summaries, mode: "personal" });
    const listed = [...prompt.matchAll(/^- \[([^\]]+)\] /gm)].map((match) => match[1]);
    const offered = offeredKeys(summaries);

    expect(listed).toEqual([...offered]);
    expect(offered.length).toBe(42);
    expect(offered[39]).toBe("oura.synthetic.m40.2026-07-10");
    expect(offered).not.toContain("oura.synthetic.m41.2026-07-10");
    expect(offered).toContain("vitronic.property.body.height.2026-07-10");
    expect(offered).not.toContain("vitronic.positions.leftHip.2026-07-10");
  });

  test("14 days of Oura and Whoop with daily workouts still list the latest workout", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const days = Array.from(
      { length: 14 },
      (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`,
    );
    const window = { startDate: days[0]!, endDate: days[13]! };
    const daily = (families: readonly string[]) =>
      families.flatMap((family) =>
        days.map((date) => ({ key: `${family}.${date}`, label: family, value: 1, date })),
      );
    const oura = {
      window,
      narrative: "Synthetic Oura window.",
      metrics: daily([
        "sleep.score.long_sleep",
        "sleep.hrv.long_sleep",
        "readiness.score",
        "activity.steps",
        "workout.duration.running",
        "workout.calories.running",
      ]),
    };
    const whoop = {
      window,
      narrative: "Synthetic Whoop window.",
      metrics: daily([
        "whoop.recovery.score",
        "whoop.cycle.strain",
        "whoop.sleep.performance",
        "whoop.workout.duration.running",
        "whoop.workout.strain.running",
      ]),
    };

    const prompt = buildTwinSystemPrompt({
      mode: "personal",
      oura,
      whoop,
      googleHealth: null,
      vitronic: null,
    });

    for (const key of [
      "workout.duration.running.2026-07-14",
      "workout.calories.running.2026-07-14",
      "whoop.workout.duration.running.2026-07-14",
      "whoop.workout.strain.running.2026-07-14",
    ]) {
      expect(prompt).toContain(`- [${key}] `);
    }
    expect(prompt).not.toContain("- [sleep.score.long_sleep.2026-07-01] ");
  });
});

const goldenWindow = { startDate: "2026-07-10", endDate: "2026-07-10" };
const goldenOura = {
  window: goldenWindow,
  narrative: "Synthetic Oura window.",
  metrics: [
    { key: "sleep.hr.2026-07-10", label: "Sleep heart rate", value: 52, unit: "bpm" },
    { key: "sleep.hrv.2026-07-10", label: "Sleep HRV", value: 61, unit: "ms" },
  ],
};
const noWearables = { oura: null, whoop: null, googleHealth: null, vitronic: null };

describe("buildTwinSystemPrompt data mode", () => {
  test("personal mode without wearables is byte-for-byte the pre-B2 prompt", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    expect(buildTwinSystemPrompt({ ...noWearables, mode: "personal" })).toMatchSnapshot();
  });

  test("personal mode with an Oura summary prints keys through formatForPrompt", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    expect(
      buildTwinSystemPrompt({ ...noWearables, oura: goldenOura, mode: "personal" }),
    ).toMatchSnapshot();
  });

  test("synthetic mode adds the cohort section once, before the wearable blocks", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const prompt = buildTwinSystemPrompt({ ...noWearables, mode: "synthetic" });
    const section = [
      "## Data mode: synthetic research cohort",
      "This session reads a synthetic research cohort generated with Synthea. The rows describe no real person.",
      "- Call `list_subjects` to get `subject_ref` values. Never invent one.",
      "- Fetch rows with `latest_by_loinc`, `observations_for_subject`, `subject_window` and `summary_stats`. Observations use LOINC codes and UCUM units.",
      "- `conditions_timeline` and `medications_timeline` list what the record holds, with dates. Say what came before or after, never that one thing caused another. Quote dosage text only as `dosage_as_recorded` gives it, labelled as recorded; never add a dose, a change or advice.",
      "- `gbd_population` gives population figures from GBD; `guideline_search` gives guideline passages; `knowledge_search` explains TwinLLM's own metrics, units, data sources and limits.",
      "- Cite tool results in Reasoning by tool, subject_ref, LOINC and date; they are recorded in tool_calls. Tool rows are not wearable keys, so they do not go under Evidence Used.",
      "- When a tool returns no rows or refuses a subject, say so plainly and do not guess values.",
      "",
      "## Wearable context (Oura)",
    ].join("\n");
    expect(prompt).toContain(section);
    expect(prompt.split("## Data mode: synthetic research cohort").length).toBe(2);
  });

  test("synthetic mode is the personal prompt plus only the cohort section", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const personal = buildTwinSystemPrompt({ ...noWearables, mode: "personal" });
    const synthetic = buildTwinSystemPrompt({ ...noWearables, mode: "synthetic" });
    const start = synthetic.indexOf("## Data mode: synthetic research cohort");
    const end = synthetic.indexOf("## Wearable context (Oura)");
    expect(synthetic.slice(0, start) + synthetic.slice(end)).toBe(personal);
    expect(personal).not.toContain("synthetic research cohort");
  });
});

describe("buildTwinSystemPrompt pasted data (eval context arm, #302)", () => {
  test("no tool lines, the rows in a delimited block after the wearables", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const block = "<data>\n[1] trend(loinc=4548-4)\nn=3\n</data>";
    const prompt = buildTwinSystemPrompt({
      ...noWearables,
      mode: "synthetic",
      offeredTools: new Set<string>(),
      pastedData: block,
    });
    expect(prompt).toContain("- This turn has no tools.");
    expect(prompt).not.toContain("list_subjects");
    expect(prompt).not.toContain("cohort record tools are turned off");
    expect(prompt).toContain(
      `## Data block (read on the server for this question)\n${block}`,
    );
    expect(prompt.indexOf("## Data block")).toBeGreaterThan(
      prompt.indexOf("## Wearable context (BodyLoop)"),
    );
  });

  test("the fair arm (#320) says the block is the subject's record, not chosen for the question", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const block = "<data>\nsubject_ref=s: 1 observation codes\n</data>";
    const base = {
      ...noWearables,
      mode: "synthetic" as const,
      offeredTools: new Set<string>(),
      pastedData: block,
    };
    const fair = buildTwinSystemPrompt({ ...base, pastedDataSource: "subject-record" });
    expect(fair).toContain(
      "The server read the record of the subject the question names",
    );
    expect(fair).toContain("It was not chosen for this question");
    expect(fair).not.toContain("with TwinLLM's query tools");
    expect(fair).toContain(
      `## Data block (read on the server for this question)\n${block}`,
    );
    // Left out, the oracle wording of #302, unchanged.
    expect(buildTwinSystemPrompt({ ...base, pastedDataSource: "key-calls" })).toBe(
      buildTwinSystemPrompt(base),
    );
  });

  test("left out or in personal mode, the prompt is as before", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const synthetic = { ...noWearables, mode: "synthetic" as const };
    expect(buildTwinSystemPrompt({ ...synthetic, pastedData: null })).toBe(
      buildTwinSystemPrompt(synthetic),
    );
    const personal = { ...noWearables, mode: "personal" as const };
    expect(buildTwinSystemPrompt({ ...personal, pastedData: "<data></data>" })).toBe(
      buildTwinSystemPrompt(personal),
    );
  });
});

describe("buildTwinSystemPrompt agent line (#218)", () => {
  const base = {
    mode: "synthetic",
    oura: null,
    whoop: null,
    googleHealth: null,
    vitronic: null,
  } as const;

  test("an agent adds one line with its name and role under the first", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    const without = buildTwinSystemPrompt(base).split("\n");
    const withAgent = buildTwinSystemPrompt({
      ...base,
      agent: {
        name: "Sleep",
        role: "Describes sleep against the person's own recent nights.",
      },
    }).split("\n");
    expect(withAgent.slice(0, 2)).toEqual([
      "You are TwinLLM, a research assistant for personalized-medicine questions.",
      "Agent: Sleep. Describes sleep against the person's own recent nights.",
    ]);
    expect(withAgent.filter((line, index) => index !== 1)).toEqual(without);
  });

  test("no agent, no line", async () => {
    const { buildTwinSystemPrompt } = await import("./twin-system-prompt");
    expect(buildTwinSystemPrompt({ ...base, agent: null })).toBe(
      buildTwinSystemPrompt(base),
    );
  });
});

describe("buildTwinSystemPrompt decline line (#274)", () => {
  const base = {
    mode: "synthetic",
    oura: null,
    whoop: null,
    googleHealth: null,
    vitronic: null,
  } as const;

  test("left out, DECLINE_RULE; given, that line in its place and nothing else changes", async () => {
    const { buildTwinSystemPrompt, DECLINE_RULE } = await import("./twin-system-prompt");
    const product = buildTwinSystemPrompt(base);
    expect(product).toContain(DECLINE_RULE);
    const other = buildTwinSystemPrompt({ ...base, declineRule: "REFUSE: test line." });
    expect(other).not.toContain(DECLINE_RULE);
    expect(other.replace("REFUSE: test line.", DECLINE_RULE)).toBe(product);
  });
});
