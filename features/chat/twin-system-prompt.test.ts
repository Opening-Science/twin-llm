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
