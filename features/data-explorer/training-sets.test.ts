import { describe, expect, test } from "bun:test";

import {
  loadConversation,
  loadTrainingSet,
  loadTrainingSets,
  type TrainingFileDeps,
} from "./training-files";
import {
  countBy,
  isSetName,
  pageMeta,
  parseConversation,
  parseManifest,
  parseMetaLines,
  setNamesFrom,
} from "./training-sets";

const meta = (family: string, outcome: string, ref: string | null, tools: string[]) =>
  JSON.stringify({
    family,
    outcome,
    subject_ref: ref,
    cohort_id: "synthea-v4-seed4242",
    seed: 4242,
    generator_version: "1",
    tool_calls: tools,
    tool_args_sha256: "0".repeat(64),
    system_prompt_id: "twin-system-prompt/synthetic/no-wearables/query-tools-only",
    system_prompt_sha256: "1".repeat(64),
    expected_answer_class: tools.length > 0 ? "analytics" : "declined_decision_support",
    synthetic: true,
  });

const META_TEXT = [
  meta("trend", "answered", "ref-a", ["subject_window", "trend"]),
  meta("latest_value", "no_rows", "ref-a", ["latest_by_loinc"]),
  "{not json",
  meta("trend", "not_enough_data", "ref-b", ["subject_window", "trend"]),
  "",
  meta("decline_dose", "declined", null, []),
].join("\n");

const CONVERSATION = JSON.stringify({
  messages: [
    { role: "system", content: "You are TwinLLM." },
    { role: "user", content: "How has weight moved for subject ref-a?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "subject_window", arguments: '{"subject_ref":"ref-a"}' },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content:
        '{"start":"2016-01-01T00:00:00.000Z","end":"2026-01-01T00:00:00.000Z","n_observations":12}',
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_2",
          type: "function",
          function: {
            name: "trend",
            arguments: '{"subject_ref":"ref-a","loinc":"29463-7"}',
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_2",
      content: '{"code":"MIXED_UNITS","loinc":"29463-7","units":["kg","[lb_av]"]}',
    },
    { role: "assistant", content: "## Reasoning\nThe tool refused." },
  ],
});

describe("set names", () => {
  test("a set is every .jsonl that is not a meta file, sorted", () => {
    expect(
      setNamesFrom([
        "train.meta.jsonl",
        "train.jsonl",
        "train.manifest.json",
        "a.jsonl.partial",
        "smoke-seed42.jsonl",
        ".hidden.jsonl",
      ]),
    ).toEqual(["smoke-seed42", "train"]);
  });

  test("names with path parts are refused", () => {
    expect(isSetName("smoke-seed42")).toBe(true);
    expect(isSetName("../etc/passwd")).toBe(false);
    expect(isSetName("a/b")).toBe(false);
    expect(isSetName("a..b")).toBe(false);
  });
});

describe("parsing", () => {
  test("a manifest keeps its counts; a broken one is null", () => {
    const manifest = parseManifest(
      JSON.stringify({
        cohort_id: "synthea-v4-seed4242",
        seed: 4242,
        subjects: 12,
        conversations: 76,
        byFamily: { trend: 12 },
        byOutcome: { answered: 44 },
        tools: [],
      }),
    );
    expect(manifest?.conversations).toBe(76);
    expect(manifest?.byFamily).toEqual({ trend: 12 });
    expect(parseManifest("{")).toBeNull();
    expect(parseManifest(null)).toBeNull();
  });

  test("meta lines are numbered in file order, skipping blanks; bad lines are counted", () => {
    const index = parseMetaLines(META_TEXT);
    expect(index.skipped).toBe(1);
    expect(index.rows.map((row) => [row.index, row.family, row.outcome])).toEqual([
      [0, "trend", "answered"],
      [1, "latest_value", "no_rows"],
      [3, "trend", "not_enough_data"],
      [4, "decline_dose", "declined"],
    ]);
  });

  test("counts per family, most first then by name", () => {
    expect(countBy(parseMetaLines(META_TEXT).rows, (row) => row.family)).toEqual([
      { key: "trend", count: 2 },
      { key: "decline_dose", count: 1 },
      { key: "latest_value", count: 1 },
    ]);
  });

  test("pages filter by family and clamp the page", () => {
    const rows = parseMetaLines(META_TEXT).rows;
    const page = pageMeta(rows, "trend", 5, 1);
    expect(page.rows.map((row) => row.index)).toEqual([3]);
    expect([page.matching, page.page, page.pages]).toEqual([2, 2, 2]);
    expect(pageMeta(rows, null, 0, 10).rows.length).toBe(4);
  });

  test("a conversation pairs each tool call with its result and finds the answer", () => {
    const view = parseConversation(CONVERSATION);
    expect(view).toEqual({
      system: "You are TwinLLM.",
      user: "How has weight moved for subject ref-a?",
      steps: [
        {
          id: "call_1",
          name: "subject_window",
          args: '{\n  "subject_ref": "ref-a"\n}',
          result:
            '{\n  "start": "2016-01-01T00:00:00.000Z",\n  "end": "2026-01-01T00:00:00.000Z",\n  "n_observations": 12\n}',
          refusal: null,
        },
        {
          id: "call_2",
          name: "trend",
          args: '{\n  "subject_ref": "ref-a",\n  "loinc": "29463-7"\n}',
          result:
            '{\n  "code": "MIXED_UNITS",\n  "loinc": "29463-7",\n  "units": [\n    "kg",\n    "[lb_av]"\n  ]\n}',
          refusal: "MIXED_UNITS",
        },
      ],
      answer: "## Reasoning\nThe tool refused.",
      refused: false,
    });
  });

  test("a REFUSE: answer is marked declined; a line that is not a record is null", () => {
    const refusal = JSON.stringify({
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "What dose should ref-a take?" },
        { role: "assistant", content: "REFUSE: I cannot pick a dose." },
      ],
    });
    expect(parseConversation(refusal)).toMatchObject({ steps: [], refused: true });
    expect(parseConversation('{"messages":[{"role":"robot"}]}')).toBeNull();
    expect(parseConversation("nope")).toBeNull();
  });
});

const files = (
  entries: Readonly<Record<string, string>>,
  actor: string | null = "local",
): TrainingFileDeps & { readonly opened: string[] } => {
  const opened: string[] = [];
  return {
    opened,
    resolveActorId: async () => actor,
    listFiles: async () => Object.keys(entries),
    readText: async (name) => {
      opened.push(name);
      return entries[name] ?? null;
    },
    readLine: async (name, index) => {
      opened.push(name);
      const text = entries[name];
      if (text === undefined) return null;
      return text.split("\n").filter((line) => line.trim() !== "")[index] ?? null;
    },
  };
};

describe("training files", () => {
  const entries = {
    "smoke.jsonl": [CONVERSATION, CONVERSATION].join("\n"),
    "smoke.meta.jsonl": META_TEXT,
  };

  test("no actor with sign-in on means sign in, before any file is opened", async () => {
    const deps = files(entries, null);
    expect(await loadTrainingSets(deps)).toEqual({ kind: "sign-in" });
    expect(await loadTrainingSet(deps, "smoke")).toEqual({ kind: "sign-in" });
    expect(await loadConversation(deps, "smoke", 0)).toEqual({ kind: "sign-in" });
    expect(deps.opened).toEqual([]);
  });

  test("lists sets with their manifest, or null without one", async () => {
    expect(await loadTrainingSets(files(entries))).toEqual({
      kind: "ok",
      sets: [{ name: "smoke", manifest: null }],
    });
  });

  test("a set outside the listing is never opened", async () => {
    const deps = files(entries);
    expect(await loadTrainingSet(deps, "../secrets")).toEqual({ kind: "not-found" });
    expect(await loadConversation(deps, "other", 0)).toEqual({ kind: "not-found" });
    expect(deps.opened).toEqual([]);
  });

  test("reads one conversation by its 0-based line; past the end is not found", async () => {
    const deps = files(entries);
    const found = await loadConversation(deps, "smoke", 1);
    expect(found.kind).toBe("ok");
    expect(deps.opened).toEqual(["smoke.jsonl"]);
    expect(await loadConversation(deps, "smoke", 2)).toEqual({ kind: "not-found" });
    expect(await loadConversation(deps, "smoke", -1)).toEqual({ kind: "not-found" });
  });

  test("a read that throws is a plain failure", async () => {
    const deps: TrainingFileDeps = {
      ...files(entries),
      listFiles: async () => {
        throw new Error("EACCES: /home/someone/training-data/out");
      },
    };
    const original = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      expect(await loadTrainingSets(deps)).toEqual({ kind: "failed" });
    } finally {
      console.error = original;
    }
    expect(logged).toEqual([["[data-explorer] training list failed", "Error"]]);
  });
});
