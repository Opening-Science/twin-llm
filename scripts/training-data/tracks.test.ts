import { describe, expect, test } from "bun:test";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCatalog } from "../genome-synth/catalog";
import { randomFor } from "../synthetic-wearables/random";

import {
  type BuildDeps,
  parseBuildArgs,
  runBuildConversations,
} from "./build-conversations";
import type { ConversationRecord } from "./conversation";
import { FAKE_COHORT, fakeTools, sampleRows } from "./fake-tools";
import {
  type Draft,
  draftsFor,
  FAMILIES,
  GENOME_FAMILIES,
  TRACK_FAMILIES,
} from "./families";
import { agentSentence, HANDOVER_BANK } from "./handover-family";
import { STYLES } from "./questions";
import {
  AGENTS,
  agentLine,
  keepsStyle,
  otherAgents,
  TRACK_IDS,
  TRACKS,
  trackMeasures,
  withAgentLine,
} from "./tracks";

const PROMPT = { id: "p", text: "You are TwinLLM, x.\nLine two." };
const GENOME_PROMPT = { id: "g", text: "You are TwinLLM, g.\nG." };

/** Three subjects: s-a with a wearable series, s-b clinical only, s-c with no rows. */
const harness = () => {
  const files = new Map<string, string>();
  const tools = fakeTools({ ...sampleRows(), "s-c": [] });
  const deps: BuildDeps = {
    dataMode: () => "synthetic",
    ports: async () => ({
      listSubjects: async () => ["s-a", "s-b", "s-c"],
      runTool: tools.run,
      systemPrompt: async () => PROMPT,
      tools: async () => [],
      genome: async () => ({ prompt: GENOME_PROMPT, tools: [] }),
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
    genomeCatalog: async () => {
      const parsed = parseCatalog(
        readFileSync(join(import.meta.dir, "../genome-synth/variants.tsv"), "utf8"),
      );
      if (typeof parsed === "string") throw new Error(parsed);
      return parsed;
    },
  };
  return { deps, files };
};

const quiet = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

const lines = <T>(jsonl: string | undefined): T[] =>
  (jsonl ?? "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);

const build = async (extra: readonly string[]) => {
  const h = harness();
  const code = await runBuildConversations(
    ["--cohort", FAKE_COHORT, "--out", "/o.jsonl", ...extra],
    quiet,
    h.deps,
  );
  return {
    code,
    files: h.files,
    records: lines<Pick<ConversationRecord, "messages">>(h.files.get("/o.jsonl")),
    metas: lines<ConversationRecord["meta"]>(h.files.get("/o.meta.jsonl")),
    manifest: JSON.parse(h.files.get("/o.manifest.json") ?? "{}") as Record<
      string,
      unknown
    >,
  };
};

/** Families that ask about a track's own measures. */
const DATA_FAMILIES = new Set<string>([
  "latest_value",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
  "near_miss",
  "unit_conversion",
  "outside_record",
  "odd_ref",
  "out_of_cohort",
]);

describe("track definitions", () => {
  test("the four existing agents keep their role lines word for word (#218)", () => {
    expect(AGENTS.general.role).toBe(
      "Looks at the whole record and says when a question is better asked of one of the specialist agents.",
    );
    expect(AGENTS.sleep.role).toBe(
      "Describes sleep against the person's own recent nights.",
    );
    expect(AGENTS.trainer.role).toBe(
      "Describes recovery, heart rate variability and training load against the person's previous four weeks.",
    );
    expect(AGENTS.genetics.role).toBe(
      "Describes the genome report the person released, one variant at a time.",
    );
    expect(TRACK_IDS.map((id) => AGENTS[id].id)).toEqual([
      "gp",
      "diet",
      "anatomy",
      "sleep",
      "trainer",
      "genetics",
    ]);
  });

  test("every track has the hand-over family, known families and resolvable codes", () => {
    const known = new Set<string>([...FAMILIES, ...GENOME_FAMILIES, ...TRACK_FAMILIES]);
    for (const id of TRACK_IDS) {
      const track = TRACKS[id];
      expect(track.id).toBe(id);
      expect(track.families).toContain("agent_handover");
      expect(track.families.every((family) => known.has(family))).toBe(true);
      expect(track.styles.every((style) => STYLES.includes(style))).toBe(true);
      expect(trackMeasures(track)?.map((measure) => measure.loinc) ?? null).toEqual(
        track.loincs,
      );
      // A track with genome families turns the genome tools on.
      expect(track.families.some((family) => family.startsWith("genome_"))).toBe(
        track.genome,
      );
    }
    expect(TRACKS.general.loincs).toBeNull();
    expect(TRACKS.diet.loincs).toEqual([
      "29463-7",
      "39156-5",
      "4548-4",
      "2339-0",
      "2093-3",
      "18262-6",
      "2085-9",
      "2571-8",
    ]);
  });

  test("no two specialists ask about the same code", () => {
    const codes = TRACK_IDS.flatMap((id) => TRACKS[id].loincs ?? []);
    expect(codes.length).toBe(new Set(codes).size);
  });

  test("no agent's hand-over topic names another agent's measure", () => {
    for (const id of TRACK_IDS) {
      const own = AGENTS[id].topics.map((topic) => topic.toLowerCase());
      for (const other of TRACK_IDS.filter((o) => o !== id)) {
        const labels = (trackMeasures(TRACKS[other]) ?? []).map((m) =>
          m.label.toLowerCase(),
        );
        expect(own.filter((topic) => labels.includes(topic))).toEqual([]);
      }
    }
  });

  test("the agent line goes right under who TwinLLM is, as in the chat", () => {
    expect(withAgentLine(PROMPT, AGENTS.diet)).toEqual({
      id: "p/agent/diet",
      text: `You are TwinLLM, x.\n${agentLine(AGENTS.diet)}\nLine two.`,
    });
    expect(agentLine(AGENTS.sleep)).toBe(
      "Agent: Sleep. Describes sleep against the person's own recent nights.",
    );
    expect(withAgentLine({ id: "q", text: "Other prompt." }, AGENTS.sleep).text).toBe(
      `${agentLine(AGENTS.sleep)}\nOther prompt.`,
    );
  });

  test("a track keeps only its styles; no track keeps every style", () => {
    expect(STYLES.every((style) => keepsStyle(null, style))).toBe(true);
    expect(keepsStyle({ styles: ["terse"] }, "terse")).toBe(true);
    expect(keepsStyle({ styles: ["terse"] }, "formal")).toBe(false);
  });

  test("other agents never include the track's own", () => {
    for (const id of TRACK_IDS) {
      expect(otherAgents(TRACKS[id]).map((agent) => agent.id)).not.toContain(
        AGENTS[id].id,
      );
      expect(otherAgents(TRACKS[id]).length).toBe(TRACK_IDS.length - 1);
    }
  });
});

describe("parseBuildArgs --track", () => {
  test("a track picks its families and a file of its own", () => {
    const args = parseBuildArgs(["--cohort", "synthea-v4-seed4242", "--track", "diet"]);
    if (typeof args === "string") throw new Error(args);
    expect(args.track?.id).toBe("diet");
    expect([...args.families]).toEqual([...TRACKS.diet.families]);
    expect(args.out).toBe("training-data/out/synthea-v4-seed4242.diet.jsonl");
    expect(args.genome).toBe(false);
  });

  test("the genetics track turns on the genome families", () => {
    const args = parseBuildArgs(["--cohort", FAKE_COHORT, "--track", "genetics"]);
    if (typeof args === "string") throw new Error(args);
    expect(args.genome).toBe(true);
    expect([...args.families]).toEqual([...GENOME_FAMILIES, "agent_handover"]);
  });

  test("refuses an unknown track and the hand-over family without one", () => {
    expect(parseBuildArgs(["--cohort", FAKE_COHORT, "--track", "poems"])).toBe(
      "--track must be one of general, diet, anatomy, sleep, trainer, genetics.",
    );
    expect(parseBuildArgs(["--cohort", FAKE_COHORT, "--track"])).toBe(
      "--track must be one of general, diet, anatomy, sleep, trainer, genetics.",
    );
    expect(
      parseBuildArgs(["--cohort", FAKE_COHORT, "--families", "trend,agent_handover"]),
    ).toBe("The agent_handover family needs --track.");
    const plain = parseBuildArgs(["--cohort", FAKE_COHORT]);
    if (typeof plain === "string") throw new Error(plain);
    expect(plain.track).toBeNull();
    expect([...plain.families]).toEqual([...FAMILIES]);
  });
});

describe("default output", () => {
  // sha256 over every file a run writes, recorded on main before tracks
  // existed (ec4d3de). A run without --track must stay byte for byte the same.
  // Update a hash only for a deliberate change to the default set.
  const GOLDEN: ReadonlyArray<readonly [readonly string[], string]> = [
    [[], "437735ddc76c6ba7af69c99f3981459762dd60e5760f6e061cf541864886d6f4"],
    [["--genome"], "ff15137d5dcf90cc0fb19743ac6ffa3251ff3bd202cb106b722d6042caee64d4"],
    [
      ["--inline-tools"],
      "9ec4e1655e80930afbc195f00324fe340fc74d2f4edc70635190478a12ef6eb5",
    ],
    [["--seed", "1"], "9d1ee4b6884c0e303951567472cf68fe27f69d785edbc0dcda0b3473ca5d5724"],
    [["--seed", "2"], "1a84d5b43be3b02e8e4d2c952bf5eeff73215c58ab3f939fe04cb62b6447a1aa"],
    [["--seed", "3"], "cea65843839d36d54c9457e69b41f4e76b0181d6b02fa7aca4d62c9965cc053e"],
    [["--seed", "4"], "ace6c653b2793389d8593866324807edb69b17bd79e5b2ebbc14bda6ab3ed154"],
    [["--seed", "5"], "8e52452678453f71d2452f8796574c654a51857903704578e3fd62ee1590daeb"],
    [["--seed", "6"], "7c68cb83908ab903be99ffefc035929070043ef0bc591497e61eb62a9b7c40b5"],
    [["--seed", "7"], "f4a919324e4699fc475470b1b1f7b296a7bfe31914aa0d39970faf08452884c9"],
    [["--seed", "8"], "981cffc7d2200f929d722c049e174b3cbd088b2e5bf8170dc604532541dcb034"],
  ];

  test("without --track every file is byte for byte what it was before tracks", async () => {
    for (const [extra, expected] of GOLDEN) {
      const { files } = await build(extra);
      const hash = createHash("sha256");
      for (const key of [...files.keys()].sort()) {
        hash.update(`${key}\n${files.get(key)}\n`);
      }
      expect([extra, hash.digest("hex")]).toEqual([extra, expected]);
    }
  });
});

describe("runBuildConversations --track", () => {
  test("every record of a track carries the agent line, and the manifest names the track", async () => {
    for (const id of TRACK_IDS) {
      const { code, records, metas, manifest } = await build(["--track", id]);
      expect(code).toBe(0);
      expect(records.length).toBeGreaterThan(0);
      const line = agentLine(AGENTS[id]);
      for (const record of records) {
        const system = String(record.messages[0]?.content);
        expect(system.split("\n")[1]).toBe(line);
      }
      for (const meta of metas) {
        expect(meta.system_prompt_id).toEndWith(`/agent/${AGENTS[id].id}`);
        expect(TRACKS[id].families).toContain(meta.family);
      }
      expect(manifest.track).toMatchObject({
        id,
        agent_id: AGENTS[id].id,
        role: AGENTS[id].role,
      });
    }
  });

  test("a specialist's data questions ask only about its codes", async () => {
    for (const id of ["diet", "sleep", "trainer", "anatomy"] as const) {
      const allowed = new Set([...(TRACKS[id].loincs ?? []), null]);
      for (const seed of ["1", "2", "3", "4"]) {
        const { metas } = await build(["--track", id, "--seed", seed]);
        const data = metas.filter((meta) => DATA_FAMILIES.has(meta.family));
        expect(data.filter((meta) => !allowed.has(meta.measure_loinc))).toEqual([]);
      }
    }
  });

  test("the sleep track asks nothing about data for a subject without a series", async () => {
    for (const seed of ["1", "2", "3"]) {
      const { metas } = await build(["--track", "sleep", "--seed", seed]);
      const clinicalOnly = metas.filter(
        (meta) =>
          meta.subject_ref !== "s-a" &&
          ["latest_value", "trend", "baseline_deviation", "coverage"].includes(
            meta.family,
          ),
      );
      expect(clinicalOnly).toEqual([]);
    }
  });

  test("the general track is the default set plus hand-overs, with the GP line", async () => {
    const plain = await build([]);
    const general = await build(["--track", "general"]);
    const kept = general.metas.flatMap((meta, index) =>
      meta.family === "agent_handover" ? [] : [index],
    );
    expect(kept.length).toBe(plain.metas.length);
    expect(kept.map((index) => general.records[index]?.messages.slice(1))).toEqual(
      plain.records.map((record) => record.messages.slice(1)),
    );
    const strip = ({
      system_prompt_id: _id,
      system_prompt_sha256: _sha,
      ...rest
    }: ConversationRecord["meta"]) => rest;
    expect(
      kept.map((index) => strip(general.metas[index] as ConversationRecord["meta"])),
    ).toEqual(plain.metas.map(strip));
  });

  test("genome records of the genetics track keep the genome prompt, with the agent line", async () => {
    const { records, metas } = await build(["--track", "genetics"]);
    const genome = metas.flatMap((meta, index) =>
      meta.family.startsWith("genome_") ? [index] : [],
    );
    expect(genome.length).toBeGreaterThan(0);
    for (const index of genome) {
      expect(records[index]?.messages[0]?.content).toBe(
        `You are TwinLLM, g.\n${agentLine(AGENTS.genetics)}\nG.`,
      );
      expect(metas[index]?.system_prompt_id).toBe("g/agent/genetics");
    }
  });
});

describe("agent_handover family", () => {
  const handovers = async (trackId: (typeof TRACK_IDS)[number], subjectRef: string) => {
    const tools = fakeTools(sampleRows());
    const { handoverFor } = await import("./handover-family");
    const found: Draft[] = [];
    for (let seed = 0; seed < 60; seed += 1) {
      const list = await draftsFor(
        {
          subjectRef,
          anchorDay: "2026-10-01",
          outsideRef: "outside-1",
          hasWearables: subjectRef === "s-a",
          run: tools.run,
        },
        (family) => randomFor(seed, `t:${subjectRef}:${family}`),
        new Set(["agent_handover"] as const),
        {
          measures: trackMeasures(TRACKS[trackId]),
          handover: handoverFor(TRACKS[trackId]),
        },
      );
      found.push(...list);
    }
    return { found, calls: tools.calls };
  };

  test("a specialist calls no tool and names an agent that fits, never itself", async () => {
    for (const id of ["diet", "anatomy", "sleep", "trainer", "genetics"] as const) {
      const { found, calls } = await handovers(id, "s-a");
      expect(found.length).toBeGreaterThan(10);
      expect(calls).toEqual([]);
      const named = new Set<string>();
      for (const draft of found) {
        expect(draft.family).toBe("agent_handover");
        expect(draft.outcome).toBe("handed_over");
        expect(draft.calls).toEqual([]);
        if (draft.reply.kind !== "sections") throw new Error("no sections");
        const target = otherAgents(TRACKS[id]).find(
          (agent) =>
            draft.reply.kind === "sections" &&
            draft.reply.sections.answer.includes(agentSentence(agent)),
        );
        if (target === undefined) throw new Error(draft.reply.sections.answer);
        named.add(target.id);
        expect(draft.reply.sections.answer).toContain(
          `outside what the ${AGENTS[id].name} agent looks at`,
        );
        expect(
          target.topics.some((topic) =>
            draft.question.toLowerCase().includes(topic.toLowerCase()),
          ),
        ).toBe(true);
      }
      expect(named.size).toBeGreaterThan(2);
    }
  });

  test("the GP answers with the audited tool and names the specialist", async () => {
    const { found } = await handovers("general", "s-a");
    const specialists = [AGENTS.diet, AGENTS.sleep, AGENTS.trainer];
    const answered = found.filter((draft) => draft.calls[0]?.name === "latest_by_loinc");
    const anatomy = found.filter((draft) => draft.calls[0]?.name === "knowledge_search");
    const genome = found.filter((draft) => draft.calls.length === 0);
    expect(answered.length).toBeGreaterThan(0);
    expect(anatomy.length).toBeGreaterThan(0);
    expect(genome.length).toBeGreaterThan(0);
    expect(answered.length + anatomy.length + genome.length).toBe(found.length);
    for (const draft of anatomy) {
      if (draft.reply.kind !== "sections") throw new Error("no sections");
      expect(draft.reply.sections.answer).toContain(agentSentence(AGENTS.anatomy));
    }
    for (const draft of answered) {
      expect(draft.calls.map((call) => call.name)).toEqual(["latest_by_loinc"]);
      if (draft.reply.kind !== "sections") throw new Error("no sections");
      const answer = draft.reply.sections.answer;
      const target = specialists.find((agent) => answer.includes(agentSentence(agent)));
      expect(target).toBeDefined();
      const codes = trackMeasures(
        TRACKS[
          target?.id === "diet" ? "diet" : target?.id === "sleep" ? "sleep" : "trainer"
        ],
      )?.map((measure) => measure.loinc);
      expect(codes).toContain(draft.measureLoinc ?? "");
    }
    for (const draft of genome) {
      expect(draft.outcome).toBe("handed_over");
      if (draft.reply.kind !== "sections") throw new Error("no sections");
      expect(draft.reply.sections.answer).toContain(agentSentence(AGENTS.genetics));
    }
  });

  test("the GP hands only clinical questions over for a subject without a series", async () => {
    const { found } = await handovers("general", "s-b");
    const codes = new Set((trackMeasures(TRACKS.diet) ?? []).map((m) => m.loinc));
    for (const draft of found.filter((d) => d.calls[0]?.name === "latest_by_loinc")) {
      expect(codes.has(draft.measureLoinc ?? "")).toBe(true);
    }
  });

  test("hand-over templates come in every style and repeat no evaluation question", () => {
    expect(Object.keys(HANDOVER_BANK.handover).sort()).toEqual([...STYLES].sort());
    const evaluation = (
      JSON.parse(
        readFileSync(join(import.meta.dir, "../../evaluation/questions.v1.json"), "utf8"),
      ) as { items: Array<{ question: string }> }
    ).items.map((item) => item.question.toLowerCase().replace(/\s+/g, " ").trim());
    const topics = TRACK_IDS.flatMap((id) => AGENTS[id].topics);
    const rendered = STYLES.flatMap((style) =>
      HANDOVER_BANK.handover[style].flatMap((template) =>
        topics.map((topic) =>
          template.replaceAll("{topic}", topic).replaceAll("{ref}", "s-a").toLowerCase(),
        ),
      ),
    );
    expect(rendered.filter((question) => evaluation.includes(question))).toEqual([]);
  });
});
