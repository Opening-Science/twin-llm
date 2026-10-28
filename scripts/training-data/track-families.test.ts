import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { randomFor } from "../synthetic-wearables/random";

import { ANATOMY_BANK, shortName, UNLISTED_MARKERS } from "./anatomy-families";
import { type BuildDeps, runBuildConversations } from "./build-conversations";
import type { ConversationRecord } from "./conversation";
import {
  FAKE_COHORT,
  type FakeRows,
  fakeTools,
  generatedWearableRows,
  sampleRows,
} from "./fake-tools";
import { type Draft, draftsFor, type Family } from "./families";
import { formatCount, formatValue } from "./format";
import {
  CATALOGUE_FILE,
  catalogueChunks,
  catalogueLine,
  namesCode,
  searchCatalogue,
} from "./knowledge-notes";
import { STYLES } from "./questions";
import { TRACKS, trackMeasures } from "./tracks";
import { lastDays, monthBefore, WEARABLE_BANK } from "./wearable-families";

/**
 * The real generator's 90-day series and workouts: s-x wears the device on
 * most days, s-w on about 15% of them (the generator's sparse wearers); s-b
 * is clinical only.
 */
const rows = (): FakeRows => ({
  ...sampleRows(),
  "s-w": generatedWearableRows(4242, "s-w"),
  "s-x": generatedWearableRows(4242, "s-x"),
});

const catalogueText = () =>
  readFileSync(join(import.meta.dir, "../../knowledge/opentwin", CATALOGUE_FILE), "utf8");

const draftsOf = async (
  family: Family,
  subjectRef: string,
  seeds = 40,
): Promise<{ found: Draft[]; results: unknown[] }> => {
  const tools = fakeTools(rows());
  const found: Draft[] = [];
  for (let seed = 0; seed < seeds; seed += 1) {
    found.push(
      ...(await draftsFor(
        {
          subjectRef,
          anchorDay: "2026-10-01",
          outsideRef: "outside-1",
          hasWearables: subjectRef !== "s-b",
          run: tools.run,
        },
        (name) => randomFor(seed, `f:${subjectRef}:${name}`),
        new Set([family]),
      )),
    );
  }
  return { found, results: found.flatMap((draft) => draft.calls.map((c) => c.result)) };
};

const answerOf = (draft: Draft): string => {
  if (draft.reply.kind !== "sections") throw new Error("no sections");
  return draft.reply.sections.answer;
};

const field = (value: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      typeof current === "object" && current !== null
        ? Reflect.get(current, key)
        : undefined,
    value,
  );

describe("wearable families", () => {
  test("the fixture is the generator's series: every wearable code and some workouts", () => {
    const codes = new Set(generatedWearableRows(4242, "s-w").map((row) => row.loinc));
    for (const code of ["40443-4", "hrv-rmssd", "93832-4", "sleep-score", "8867-4"]) {
      expect(codes.has(code)).toBe(true);
    }
    expect([...codes].some((code) => code.startsWith("workout-"))).toBe(true);
  });

  test("hrv_trend and resting_hr_trend report the tool's own numbers", async () => {
    for (const family of ["hrv_trend", "resting_hr_trend"] as const) {
      const { found } = await draftsOf(family, "s-x");
      expect(found.length).toBe(40);
      for (const draft of found) {
        expect(draft.calls.map((call) => call.name)).toEqual([family]);
        expect(draft.outcome).toBe("answered");
        const result = draft.calls[0]?.result;
        const n = Number(field(result, "sources", 0, "n"));
        expect(answerOf(draft)).toContain(`Over ${formatCount(n)} daily readings`);
        const recent = field(result, "sources", 0, "recent", "median");
        expect(answerOf(draft)).toContain(
          formatValue(Number(recent), String(field(result, "sources", 0, "unit")), 1),
        );
      }
    }
  });

  test("a sparse wearer gets the refusals the tool gives, never a made-up slope", async () => {
    const { found } = await draftsOf("hrv_trend", "s-w");
    const outcomes = new Set(found.map((draft) => draft.outcome));
    expect(outcomes.has("WINDOW_TOO_SHORT") || outcomes.has("answered")).toBe(true);
    for (const draft of found.filter((d) => d.outcome !== "answered")) {
      expect(field(draft.calls[0]?.result, "code")).toBeDefined();
      expect(answerOf(draft)).not.toMatch(/slope is/);
    }
  });

  test("a subject without a series gets no wearable question", async () => {
    for (const family of [
      "hrv_trend",
      "resting_hr_trend",
      "training_load",
      "sleep_summary",
      "wearable_too_short",
    ] as const) {
      expect((await draftsOf(family, "s-b", 10)).found).toEqual([]);
    }
  });

  test("training_load gives sessions, minutes and the recent load ratio as returned", async () => {
    const { found } = await draftsOf("training_load", "s-x");
    for (const draft of found) {
      expect(draft.outcome).toBe("answered");
      const source = field(draft.calls[0]?.result, "sources", 0);
      const sessions = Number(field(source, "sessions"));
      expect(answerOf(draft)).toContain(`has ${formatCount(sessions)} workout`);
      expect(answerOf(draft)).toContain(
        formatValue(Number(field(source, "minutes")), "min", 0),
      );
      expect(draft.calls[0]?.args).toMatchObject({ source: "all" });
    }
  });

  test("sleep_summary gives nights and means as returned", async () => {
    const { found } = await draftsOf("sleep_summary", "s-x");
    for (const draft of found) {
      expect(draft.outcome).toBe("answered");
      const source = field(draft.calls[0]?.result, "sources", 0);
      expect(answerOf(draft)).toContain(
        `Mean sleep duration was ${formatValue(Number(field(source, "mean_duration_min")), "min", 0)}`,
      );
    }
  });

  test("a window of a few days is refused with WINDOW_TOO_SHORT", async () => {
    const { found } = await draftsOf("wearable_too_short", "s-x", 80);
    expect(found.length).toBeGreaterThan(10);
    const outcomes = new Set(found.map((draft) => draft.outcome));
    expect(outcomes.has("WINDOW_TOO_SHORT")).toBe(true);
    for (const draft of found) {
      expect(["WINDOW_TOO_SHORT", "no_rows"]).toContain(draft.outcome);
      expect(field(draft.calls[0]?.result, "code")).toBe(
        draft.outcome === "no_rows" ? "NO_ROWS" : "WINDOW_TOO_SHORT",
      );
      expect(answerOf(draft)).not.toMatch(/slope is/);
    }
  });

  test("a window before the series is refused with NO_ROWS, for every subject", async () => {
    for (const family of ["wearable_no_rows", "sleep_no_rows"] as const) {
      for (const subject of ["s-x", "s-b"]) {
        const { found } = await draftsOf(family, subject, 20);
        expect(found.length).toBeGreaterThan(0);
        for (const draft of found) {
          expect(draft.outcome).toBe("no_rows");
          expect(field(draft.calls[0]?.result, "code")).toBe("NO_ROWS");
          expect(answerOf(draft)).toContain("I will not fill the gap");
        }
      }
    }
  });

  test("windows: the last n days end on the anchor, a month before stays before the series", () => {
    expect(lastDays("2026-10-01", 7)).toEqual({
      start: "2026-09-25T00:00:00.000Z",
      end: "2026-10-01T23:59:59.999Z",
    });
    const month = monthBefore(() => 0.99, "2026-10-01");
    expect(month).toEqual({
      start: "2025-12-01T00:00:00.000Z",
      end: "2025-12-31T23:59:59.999Z",
    });
  });
});

describe("knowledge stand-in and anatomy_note", () => {
  test("the catalogue is cut by the ingest's chunker and searched by LOINC code", () => {
    const chunks = catalogueChunks(catalogueText());
    expect(chunks.length).toBeGreaterThan(5);
    expect(Object.keys(chunks[0] ?? {}).sort()).toEqual(
      ["file", "id", "licence", "passage", "sectionHeading", "title"].sort(),
    );
    const hits = searchCatalogue(chunks, { query: "HbA1c LOINC 4548-4", k: 3 });
    expect(hits.length).toBe(1);
    expect(hits[0]?.sectionHeading).toContain("metabolic glycemic");
    expect(catalogueLine(hits[0]?.passage ?? "", "4548-4")).toMatchObject({
      system: "metabolic",
      region: "metabolic glycemic",
      noSingleLocation: false,
    });
    expect(searchCatalogue(chunks, { query: "where is the liver", k: 3 })).toEqual([]);
    expect(namesCode("LOINC 2093-3, unit", "2093-3")).toBe(true);
    expect(namesCode("LOINC 2093-35, unit", "2093-3")).toBe(false);
  });

  test("an answer cites the passage it found and says only what it lists", async () => {
    const { found } = await draftsOf("anatomy_note", "s-a", 60);
    const answered = found.filter((draft) => draft.outcome === "answered");
    const empty = found.filter((draft) => draft.outcome === "no_rows");
    expect(answered.length).toBeGreaterThan(20);
    expect(empty.length).toBeGreaterThan(0);
    for (const draft of answered) {
      expect(draft.calls.map((call) => call.name)).toEqual(["knowledge_search"]);
      expect(draft.subjectRef).toBeNull();
      const hits = draft.calls[0]?.result as Array<{ passage: string; file: string }>;
      const line = hits
        .map((hit) => catalogueLine(hit.passage, draft.measureLoinc ?? ""))
        .find((found) => found !== null);
      if (!line || draft.reply.kind !== "sections") throw new Error("no line");
      expect(draft.reply.sections.reasoning).toContain(line.line);
      expect(draft.reply.sections.reasoning).toContain(
        "knowledge/opentwin/biomarker-catalogue.md",
      );
      expect(answerOf(draft)).toContain(
        `under the ${line.system} system, region ${line.region}.`,
      );
    }
    for (const draft of empty) {
      expect(UNLISTED_MARKERS.map((marker) => marker.code)).toContain(draft.measureLoinc);
      expect(draft.calls[0]?.result).toEqual([]);
      expect(answerOf(draft)).toContain("I will not guess one.");
    }
  });

  test("short names drop the LOINC property and specimen", () => {
    expect(shortName("Cholesterol [Mass/volume] in Serum or Plasma")).toBe("Cholesterol");
    expect(shortName("Hemoglobin A1c/Hemoglobin.total in Blood")).toBe(
      "Hemoglobin A1c/Hemoglobin.total",
    );
  });
});

describe("track styles", () => {
  const build = async (track: string, seed = "3") => {
    const files = new Map<string, string>();
    const tools = fakeTools(rows());
    const deps: BuildDeps = {
      dataMode: () => "synthetic",
      ports: async () => ({
        listSubjects: async () => ["s-a", "s-b", "s-w", "s-x"],
        runTool: tools.run,
        systemPrompt: async () => ({ id: "p", text: "You are TwinLLM, x." }),
        tools: async () => [],
      }),
      openOut: async (path) => {
        files.set(path, "");
        return {
          write: async (line) => {
            files.set(path, `${files.get(path) ?? ""}${line}`);
          },
          close: async () => undefined,
        };
      },
      writeText: async (path, text) => {
        files.set(path, text);
      },
      rename: async (from, to) => {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
      },
      remove: async (path) => {
        files.delete(path);
      },
      readText: async () => null,
    };
    const quiet = {
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
    };
    expect(
      await runBuildConversations(
        ["--cohort", FAKE_COHORT, "--out", "/o.jsonl", "--track", track, "--seed", seed],
        quiet,
        deps,
      ),
    ).toBe(0);
    return (files.get("/o.meta.jsonl") ?? "")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ConversationRecord["meta"]);
  };

  test("trainer and sleep keep only their styles; the others keep all four", async () => {
    expect(TRACKS.trainer.styles).toEqual(["casual", "terse"]);
    expect(TRACKS.sleep.styles).toEqual(["formal", "casual"]);
    for (const id of ["trainer", "sleep"] as const) {
      const metas = await build(id);
      expect(metas.length).toBeGreaterThan(0);
      expect(metas.every((meta) => TRACKS[id].styles.includes(meta.style))).toBe(true);
    }
    for (const id of ["general", "diet", "anatomy", "genetics"] as const) {
      expect(TRACKS[id].styles).toEqual(STYLES);
    }
  });

  test("the trainer and sleep tracks run their wearable tools on the series", async () => {
    const trainer = (
      await Promise.all(["1", "2", "3", "4", "5"].map((seed) => build("trainer", seed)))
    ).flat();
    const tools = new Set(trainer.flatMap((meta) => meta.tool_calls));
    for (const tool of ["hrv_trend", "resting_hr_trend", "training_load"]) {
      expect(tools.has(tool)).toBe(true);
    }
    const sleep = (
      await Promise.all(["1", "2", "3", "4", "5"].map((seed) => build("sleep", seed)))
    ).flat();
    expect(sleep.some((meta) => meta.tool_calls.includes("sleep_summary"))).toBe(true);
    expect(trackMeasures(TRACKS.sleep)?.map((m) => m.loinc)).toContain("93832-4");
  });
});

describe("new question banks", () => {
  test("repeat no evaluation question", () => {
    const evaluation = new Set(
      (
        JSON.parse(
          readFileSync(
            join(import.meta.dir, "../../evaluation/questions.v1.json"),
            "utf8",
          ),
        ) as { items: Array<{ question: string }> }
      ).items.map((item) => item.question.toLowerCase().replace(/\s+/g, " ").trim()),
    );
    const fill = (text: string) =>
      text
        .replaceAll("{ref}", "s-a")
        .replaceAll("{start}", "1 Sep 2026")
        .replaceAll("{end}", "1 Oct 2026")
        .replaceAll("{label}", "HRV (RMSSD)")
        .replaceAll("{name}", "Cholesterol")
        .replaceAll("{code}", "2093-3")
        .toLowerCase();
    const banks = [...Object.values(WEARABLE_BANK), ...Object.values(ANATOMY_BANK)];
    const rendered = banks.flatMap((bank) =>
      STYLES.flatMap((style) => bank[style].map(fill)),
    );
    expect(rendered.filter((question) => evaluation.has(question))).toEqual([]);
  });
});
