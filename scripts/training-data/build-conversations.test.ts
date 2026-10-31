import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { genomeToolList } from "../../packages/carbon-x/manifest";
import { noConsentStore } from "../../infrastructure/learning-consent";
import { parseCatalog } from "../genome-synth/catalog";

import {
  type BuildDeps,
  parseBuildArgs,
  runBuildConversations,
} from "./build-conversations";
import type { OpenAiTool } from "./chat-tool-list";
import type { ConversationRecord } from "./conversation";
import { FAKE_COHORT, fakeTools, sampleRows } from "./fake-tools";
import { STAND_IN_SOURCE } from "./genome-families";

const PROMPT = {
  id: "test-prompt",
  text: [
    "You are TwinLLM (test prompt).",
    "- `gbd_population` gives population figures; `guideline_search` gives passages.",
    "- Call `list_subjects` first.",
  ].join("\n"),
};

const TOOLS: readonly OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "trend",
      description: "Test tool.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const harness = (overrides: Partial<BuildDeps> = {}) => {
  const tools = fakeTools(sampleRows());
  const files = new Map<string, string>();
  const out: string[] = [];
  const err: string[] = [];
  const deps: BuildDeps = {
    dataMode: () => "synthetic",
    subjectRows: async (cohortId) => [{ kind: "subject", cohortId, isSynthetic: true }],
    learning: noConsentStore(),
    ports: async () => ({
      listSubjects: async (cohortId) => (cohortId === FAKE_COHORT ? ["s-a", "s-b"] : []),
      runTool: tools.run,
      systemPrompt: async () => PROMPT,
      tools: async () => TOOLS,
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
    readText: async (path) => files.get(path) ?? null,
    ...overrides,
  };
  const io = {
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
  };
  return { deps, io, files, out, err, calls: tools.calls };
};

const lines = <T>(jsonl: string | undefined): T[] =>
  (jsonl ?? "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);

describe("parseBuildArgs", () => {
  test("takes the preset seed and a gitignored default path", () => {
    const args = parseBuildArgs(["--cohort", "synthea-v4-seed4242"]);
    if (typeof args === "string") throw new Error(args);
    expect(args.seed).toBe(4242);
    expect(args.out).toBe("training-data/out/synthea-v4-seed4242.jsonl");
    expect(args.anchorDay).toBe("2026-10-01");
    expect(args.allowEvalCohort).toBe(false);
  });

  test("a 1M batch cohort takes its batch seed", () => {
    const args = parseBuildArgs(["--cohort", "synthea-v4-seed1100"]);
    if (typeof args === "string") throw new Error(args);
    expect(args.seed).toBe(1100);
    expect(args.out).toBe("training-data/out/synthea-v4-seed1100.jsonl");
  });

  test("refuses unknown families and a cohort without a seed", () => {
    expect(parseBuildArgs(["--cohort", FAKE_COHORT, "--families", "trend,poems"])).toBe(
      "Unknown families: poems.",
    );
    expect(parseBuildArgs(["--cohort", "open-twin-synthea-trimmed-3"])).toBe(
      "--seed must be a whole number (no preset seed for this cohort).",
    );
  });
});

describe("runBuildConversations guards", () => {
  test("runs only with DATA_MODE=synthetic", async () => {
    const h = harness({ dataMode: () => "personal" });
    expect(await runBuildConversations(["--cohort", FAKE_COHORT], h.io, h.deps)).toBe(1);
    expect(h.err.join("")).toBe(
      "training:conversations runs only with DATA_MODE=synthetic.\n",
    );
    expect(h.files.size).toBe(0);
  });

  test("refuses the evaluation cohort unless told it is a smoke run", async () => {
    const h = harness();
    expect(
      await runBuildConversations(["--cohort", "synthea-v4-seed42"], h.io, h.deps),
    ).toBe(1);
    expect(h.err.join("")).toBe(
      'Cohort "synthea-v4-seed42" is the evaluation cohort; training on it would leak the test set. Use synthea-v4-seed4242 (pass --allow-eval-cohort for a smoke run only).\n',
    );
    expect(h.calls).toEqual([]);
    const smoke = harness();
    // Allowed past the guard; the fake has no subjects for it, so it stops there.
    expect(
      await runBuildConversations(
        ["--cohort", "synthea-v4-seed42", "--allow-eval-cohort"],
        smoke.io,
        smoke.deps,
      ),
    ).toBe(1);
    expect(smoke.err.join("")).toBe("No subjects in cohort synthea-v4-seed42.\n");
  });

  test("refuses a cohort that is not on the allowlist", async () => {
    const h = harness();
    expect(
      await runBuildConversations(
        ["--cohort", "real-people", "--seed", "1"],
        h.io,
        h.deps,
      ),
    ).toBe(1);
    expect(h.err.join("")).toBe(
      'Cohort "real-people" is not an allowed synthetic cohort.\n',
    );
  });

  test("a failing tool stops the run with a plain sentence", async () => {
    const h = harness();
    const failing = harness({
      ports: async () => ({
        ...(await h.deps.ports()),
        runTool: async () => {
          throw new Error("connection refused at 10.0.0.1");
        },
      }),
    });
    expect(
      await runBuildConversations(["--cohort", FAKE_COHORT], failing.io, failing.deps),
    ).toBe(1);
    expect(failing.err.join("")).toBe(
      "Conversations stopped: a tool call failed or its arguments did not validate. Nothing was kept.\n",
    );
    // The partial files are removed and no final file appears.
    expect([...failing.files.keys()]).toEqual([]);
  });
});

describe("runBuildConversations output", () => {
  const OUT = "/tmp/out.jsonl";
  const run = async (extra: readonly string[] = []) => {
    const h = harness();
    const code = await runBuildConversations(
      ["--cohort", FAKE_COHORT, "--out", OUT, ...extra],
      h.io,
      h.deps,
    );
    return {
      ...h,
      code,
      records: lines<Pick<ConversationRecord, "messages" | "tools">>(h.files.get(OUT)),
      metas: lines<ConversationRecord["meta"]>(h.files.get("/tmp/out.meta.jsonl")),
      manifest: JSON.parse(h.files.get("/tmp/out.manifest.json") ?? "{}") as Record<
        string,
        unknown
      >,
    };
  };

  test("writes records, a meta sidecar, a manifest and stats, and no partial file", async () => {
    const result = await run();
    expect(result.code).toBe(0);
    expect([...result.files.keys()].sort()).toEqual([
      "/tmp/out.jsonl",
      "/tmp/out.manifest.json",
      "/tmp/out.meta.jsonl",
      "/tmp/out.stats.json",
    ]);
    expect(result.metas.length).toBe(result.records.length);
    expect(result.manifest.tools).toEqual(TOOLS);
    const stats = JSON.parse(result.files.get("/tmp/out.stats.json") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(stats.conversations).toBe(result.records.length);
    expect(
      Object.values(stats.by_family as Record<string, number>).reduce((a, b) => a + b),
    ).toBe(result.records.length);
    expect(result.manifest.conversations).toBe(result.records.length);
    expect(result.manifest.subjects).toBe(2);
    expect(result.out.join("")).toContain(
      `Cohort ${FAKE_COHORT}, seed 4242: 2 subjects, ${result.records.length} conversations`,
    );
  });

  test("--rejected puts the left-out bundles in the manifest", async () => {
    const h = harness();
    h.files.set(
      "/tmp/out.rejected.json",
      JSON.stringify({
        cohort_id: FAKE_COHORT,
        bundles: 11416,
        rejected: 36,
        reasons: { "ot-quantity-no-code": 14, "ot-unit-policy": 22 },
        subjects: [],
      }),
    );
    const code = await runBuildConversations(
      ["--cohort", FAKE_COHORT, "--out", OUT, "--rejected", "/tmp/out.rejected.json"],
      h.io,
      h.deps,
    );
    expect(code).toBe(0);
    const manifest = JSON.parse(h.files.get("/tmp/out.manifest.json") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(manifest.rejected_bundles).toEqual({
      count: 36,
      of: 11416,
      reasons: { "ot-quantity-no-code": 14, "ot-unit-policy": 22 },
      file: "/tmp/out.rejected.json",
    });
    expect((await run()).manifest.rejected_bundles).toBeUndefined();
  });

  test("--rejected with a missing or wrong file writes nothing", async () => {
    const h = harness();
    h.files.set("/tmp/bad.json", JSON.stringify({ rejected: "36" }));
    for (const file of ["/tmp/missing.json", "/tmp/bad.json"]) {
      expect(
        await runBuildConversations(
          ["--cohort", FAKE_COHORT, "--out", OUT, "--rejected", file],
          h.io,
          h.deps,
        ),
      ).toBe(1);
    }
    expect(h.err).toEqual([
      "--rejected /tmp/missing.json is not a rejected-bundles file.\n",
      "--rejected /tmp/bad.json is not a rejected-bundles file.\n",
    ]);
    expect([...h.files.keys()]).toEqual(["/tmp/bad.json"]);
  });

  test("is deterministic for a seed and changes with another", async () => {
    const first = await run();
    const second = await run();
    const other = await run(["--seed", "7"]);
    expect(first.files.get(OUT)).toBe(second.files.get(OUT));
    expect(first.files.get("/tmp/out.meta.jsonl")).toBe(
      second.files.get("/tmp/out.meta.jsonl"),
    );
    expect(other.files.get(OUT)).not.toBe(first.files.get(OUT));
  });

  test("records hold messages only; --inline-tools adds the tools", async () => {
    const plain = await run(["--families", "trend"]);
    expect(plain.records.length).toBe(2);
    expect(plain.records.map((record) => Object.keys(record))).toEqual([
      ["messages"],
      ["messages"],
    ]);
    const inline = await run(["--families", "trend", "--inline-tools"]);
    expect(inline.records[0]?.tools).toEqual(TOOLS);
  });

  test("the system prompt is the chat's, unchanged, and meta names it", async () => {
    const { records, metas } = await run(["--families", "trend"]);
    expect(records[0]?.messages[0]).toEqual({ role: "system", content: PROMPT.text });
    expect(metas[0]?.system_prompt_id).toBe("test-prompt");
  });

  test("meta lines match their records in order", async () => {
    const { records, metas } = await run(["--families", "trend"]);
    const [record] = records;
    const [meta] = metas;
    if (!record || !meta) throw new Error("no record");
    expect(record.messages.map((message) => message.role)).toEqual(
      meta.tool_calls.length === 2
        ? ["system", "user", "assistant", "tool", "assistant", "tool", "assistant"]
        : ["system", "user", "assistant", "tool", "assistant"],
    );
    expect(record.messages[2]).toMatchObject({ role: "assistant", content: null });
    expect(String(record.messages.at(-1)?.content)).toStartWith("## Reasoning\n");
    expect(meta).toMatchObject({
      family: "trend",
      subject_ref: "s-a",
      cohort_id: FAKE_COHORT,
      seed: 4242,
      generator_version: "2",
      measure_loinc: meta.measure_loinc,
      synthetic: true,
    });
    expect(meta.template_id).toStartWith(`${meta.template_group}.`);
    expect(meta.template_group).toMatch(/^trend(Wearable|Recent|Clinical)\./);
    expect(meta.tool_args_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("every final turn has the four headings or a REFUSE line", async () => {
    const { records, metas } = await run();
    const finals = records.map((record) => String(record.messages.at(-1)?.content));
    const shaped = finals.filter(
      (text) =>
        text.startsWith("REFUSE: ") ||
        ["## Reasoning", "## Evidence Used", "## Answer", "## Uncertainty"].every(
          (heading) => text.includes(heading),
        ),
    );
    expect(shaped.length).toBe(records.length);
    const declined = metas.filter((meta) => meta.outcome === "declined");
    expect(
      declined.every(
        (meta) => meta.expected_answer_class === "declined_decision_support",
      ),
    ).toBe(true);
  });

  test("leaving a family out does not change the others", async () => {
    const all = await run();
    const trendOnly = await run(["--families", "trend"]);
    const trendIndexes = all.metas.flatMap((meta, index) =>
      meta.family === "trend" ? [index] : [],
    );
    expect(trendIndexes.map((index) => all.records[index])).toEqual(trendOnly.records);
  });
});

describe("runBuildConversations --genome", () => {
  const OUT = "/tmp/out.jsonl";
  const GENOME_PROMPT = { id: "test-genome-prompt", text: "Genome turn (test prompt)." };
  // The real genome tool definitions (#107), after the chat's.
  const GENOME_TOOLS: readonly OpenAiTool[] = [...TOOLS, ...genomeToolList()];
  const catalog = async () => {
    const parsed = parseCatalog(
      readFileSync(join(import.meta.dir, "../genome-synth/variants.tsv"), "utf8"),
    );
    if (typeof parsed === "string") throw new Error(parsed);
    return parsed;
  };
  const run = async (extra: readonly string[], withGenome = true) => {
    const h = harness();
    const deps: BuildDeps = withGenome
      ? {
          ...h.deps,
          genomeCatalog: catalog,
          ports: async () => ({
            ...(await h.deps.ports()),
            genome: async () => ({ prompt: GENOME_PROMPT, tools: GENOME_TOOLS }),
          }),
        }
      : h.deps;
    const code = await runBuildConversations(
      ["--cohort", FAKE_COHORT, "--out", OUT, ...extra],
      h.io,
      deps,
    );
    return {
      ...h,
      code,
      records: lines<Pick<ConversationRecord, "messages" | "tools">>(h.files.get(OUT)),
      metas: lines<ConversationRecord["meta"]>(h.files.get("/tmp/out.meta.jsonl")),
      manifest: JSON.parse(h.files.get("/tmp/out.manifest.json") ?? "{}") as Record<
        string,
        unknown
      >,
      stats: JSON.parse(h.files.get("/tmp/out.stats.json") ?? "{}") as Record<
        string,
        unknown
      >,
    };
  };

  test("genome families need the flag", () => {
    expect(
      parseBuildArgs(["--cohort", FAKE_COHORT, "--families", "genome_variant"]),
    ).toBe("Genome families need --genome.");
    const off = parseBuildArgs(["--cohort", FAKE_COHORT]);
    if (typeof off === "string") throw new Error(off);
    expect(off.genome).toBe(false);
    expect([...off.families].some((family) => family.startsWith("genome_"))).toBe(false);
  });

  test("a run without --genome is byte-identical to the genome run minus its genome lines", async () => {
    const off = await run([]);
    const offInline = await run(["--inline-tools"]);
    const on = await run(["--genome", "--inline-tools"]);
    expect(off.manifest.genome).toBeUndefined();
    expect(off.manifest.tools).toEqual(TOOLS);
    expect(off.stats.genome_share).toBeUndefined();
    const keep = on.metas.flatMap((meta, index) =>
      meta.family.startsWith("genome_") ? [] : [index],
    );
    expect(keep.map((index) => on.records[index])).toEqual(offInline.records);
    expect(keep.map((index) => on.metas[index])).toEqual(off.metas);
    expect(on.manifest.tools).toEqual(TOOLS);
    expect(on.manifest.genome).toEqual({
      catalog_version: "genome-synth-v1",
      system_prompt_id: "test-genome-prompt",
      tools: GENOME_TOOLS,
    });
    const genome = on.metas.flatMap((meta, index) =>
      meta.family.startsWith("genome_") ? [index] : [],
    );
    expect(genome.length).toBe(on.metas.length - off.metas.length);
    for (const index of genome) {
      expect(on.records[index]?.tools).toEqual(GENOME_TOOLS);
      expect(on.records[index]?.messages[0]).toEqual({
        role: "system",
        content: GENOME_PROMPT.text,
      });
      expect(on.metas[index]?.system_prompt_id).toBe("test-genome-prompt");
    }
    expect(on.stats.genome_share).toBe(
      Math.round((genome.length / on.metas.length) * 10_000) / 10_000,
    );
  });

  test("a variant question reads the report, then asks dna_ask with the rsid only", async () => {
    const { records, metas } = await run([
      "--genome",
      "--families",
      "genome_variant",
      "--seed",
      "1",
    ]);
    expect(metas.map((meta) => meta.family)).toEqual(["genome_variant"]);
    const [record] = records;
    if (!record) throw new Error("no record");
    const names = record.messages.flatMap((message) =>
      "tool_calls" in message ? message.tool_calls.map((call) => call.function.name) : [],
    );
    expect(names).toEqual(["genome_report", "dna_ask"]);
    const ask = record.messages[4];
    if (!ask || !("tool_calls" in ask)) throw new Error("no dna_ask call");
    const args = JSON.parse(ask.tool_calls[0]?.function.arguments ?? "{}") as unknown;
    expect(Object.keys(Object(args))).toEqual(["rsid"]);
    expect(JSON.parse(String(record.messages[5]?.content))).toMatchObject({
      source: STAND_IN_SOURCE,
      withheld_sentences: 0,
    });
    expect(metas[0]?.tool_calls).toEqual(["genome_report", "dna_ask"]);
    expect(metas[0]?.expected_answer_class).toBe("information");
  });

  test("--genome without the genome turn stops with a plain sentence", async () => {
    const result = await run(["--genome"], false);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      "--genome needs the variant catalog and the genome turn's tools.\n",
    ]);
  });
});

describe("the learning-consent gate (#145)", () => {
  const OUT = "/tmp/out.jsonl";
  const ARGS = ["--cohort", FAKE_COHORT, "--out", OUT];
  const AT = new Date("2026-10-31T12:00:00Z");
  const OWNER = "app-user-synthetic-1";
  const PERSONAL = { kind: "personal", ownerId: OWNER, source: "wearables" } as const;
  const grant = {
    id: "consent-1",
    userId: OWNER,
    scope: "training",
    sources: ["wearables"],
    wordingVersion: "learning-consent.v1",
    wordingSha256: "0".repeat(64),
    grantedAt: new Date("2026-10-01T00:00:00Z"),
    withdrawnAt: null,
  } as const;

  test("a synthetic cohort passes and its manifest is unchanged", async () => {
    const h = harness();
    expect(await runBuildConversations(ARGS, h.io, h.deps)).toBe(0);
    const manifest = JSON.parse(h.files.get("/tmp/out.manifest.json") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(manifest.learning_consents).toBe(undefined);
  });

  test("a subject that is not synthetic is refused before any tool runs", async () => {
    const h = harness({
      subjectRows: async (cohortId) => [
        { kind: "subject", cohortId, isSynthetic: true },
        { kind: "subject", cohortId, isSynthetic: false },
      ],
    });
    expect(await runBuildConversations(ARGS, h.io, h.deps)).toBe(1);
    expect([h.err, h.calls.length, [...h.files.keys()]]).toEqual([
      [
        `Refused (SOURCE_NOT_SYNTHETIC): A subject in cohort "${FAKE_COHORT}" is not marked synthetic or its cohort is not a listed synthetic cohort, and it has no owner who could consent. Nothing was read.\n`,
      ],
      0,
      [],
    ]);
  });

  test("a personal row is refused without consent, with a withdrawn one and with another scope's", async () => {
    const codes: string[] = [];
    for (const consents of [
      [],
      [{ ...grant, withdrawnAt: new Date("2026-10-20T00:00:00Z") }],
      [{ ...grant, scope: "evaluation" as const }],
    ]) {
      const h = harness({
        subjectRows: async () => [PERSONAL],
        learning: { loadConsents: async () => consents, now: () => AT },
      });
      expect(await runBuildConversations(ARGS, h.io, h.deps)).toBe(1);
      expect([...h.files.keys()]).toEqual([]);
      codes.push(/^Refused \((\w+)\)/.exec(h.err.join(""))?.[1] ?? "");
    }
    expect(codes).toEqual([
      "LEARNING_CONSENT_MISSING",
      "LEARNING_CONSENT_WITHDRAWN",
      "LEARNING_CONSENT_SCOPE",
    ]);
  });

  test("a matching consent is named in the manifest", async () => {
    const h = harness({
      subjectRows: async () => [PERSONAL],
      learning: { loadConsents: async () => [grant], now: () => AT },
    });
    expect(await runBuildConversations(ARGS, h.io, h.deps)).toBe(0);
    const manifest = JSON.parse(h.files.get("/tmp/out.manifest.json") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(manifest.learning_consents).toEqual({
      scope: "training",
      consent_ids: ["consent-1"],
    });
  });

  test("a consent withdrawn during the run keeps nothing", async () => {
    let asked = 0;
    const h = harness({
      subjectRows: async () => [PERSONAL],
      learning: {
        loadConsents: async () => {
          asked += 1;
          return asked === 1 ? [grant] : [{ ...grant, withdrawnAt: AT }];
        },
        now: () => AT,
      },
    });
    expect(await runBuildConversations(ARGS, h.io, h.deps)).toBe(1);
    expect([[...h.files.keys()], h.err.join("").endsWith("Nothing was kept.\n")]).toEqual(
      [[], true],
    );
  });
});
