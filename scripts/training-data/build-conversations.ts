/**
 * Host CLI: training conversations for safe tool use, from a synthetic cohort.
 *
 *   bun run training:conversations -- --cohort synthea-v4-seed4242
 *   bun run training:conversations -- --cohort synthea-v4-seed4242 --out training-data/out/train.jsonl \
 *     --seed 4242 --anchor 2026-10-01 --max-subjects 500 --families trend,coverage --inline-tools
 *   bun run training:conversations -- --cohort synthea-v4-seed1001 --rejected <out>/synthea-v4-seed1001.rejected.json
 *   bun run training:conversations -- --cohort synthea-v4-seed4242 --track diet
 *
 * Writes `<out>.jsonl` (messages only; tools too with --inline-tools),
 * `<out>.meta.jsonl` (one meta record per line, same order),
 * `<out>.manifest.json` (counts and the tool definitions) and
 * `<out>.stats.json` (counts per family and template, shares, lengths). Both
 * JSONL files are written as `.partial` and renamed only when the run
 * finishes. The system prompt and the twelve tools are the ones a chat
 * request sends in synthetic mode. `--track <id>` (`tracks.ts`) keeps one
 * agent's families, codes and styles, adds the hand-over family, and puts the
 * agent's role line in every system prompt; without it the output is the same
 * as before tracks, byte for byte.
 *
 * `.env.training` (gitignored) is a copy of `.env.synthetic.example` with
 * DATABASE_URL at a database that holds only the training (or held-out)
 * cohort; the script never loads `.env.local`. Every number in an answer comes
 * from the closed, audited query tools (actor `training-conversations`), never
 * from a model. It refuses the evaluation cohort unless `--allow-eval-cohort`
 * (smoke runs only). Before it reads and again before it keeps anything it asks
 * the learning-consent gate (#145): a subject that is not synthetic is refused,
 * and the manifest names the consents the set relied on. Prints counts only,
 * never values. See docs/training-data.md.
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  learningManifest,
  learningRefusalLine,
  type LearningGateDeps,
  type LearningRow,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";
import { isAllowedCohort } from "../../packages/query-tools/scope";
import { guidelineSearchInput } from "../../packages/guidelines/input";
import { subjectWindowInput } from "../../packages/query-tools/schemas";
import { KEYED_TOOLS } from "../evaluation/question-set";
import {
  COHORT_PRESETS,
  EVALUATION_COHORT_IDS,
  SYNTHEA_1M_BATCH_COHORTS,
} from "../synthea/cohort-presets";
import { stableUuid } from "../synthetic-wearables/bundle";
import { randomFor } from "../synthetic-wearables/random";
import { DEFAULT_END_DAY } from "../synthetic-wearables/series";

import type { OpenAiTool } from "./chat-tool-list";
import { GENERATOR_VERSION, type SystemPrompt, toConversation } from "./conversation";
import type { Variant } from "../genome-synth/catalog";
import { CATALOG_VERSION } from "../genome-synth/genotypes";

import {
  draftsFor,
  type Family,
  FAMILIES,
  GENOME_FAMILIES,
  type ToolName,
  TRACK_FAMILIES,
  type TrackScope,
} from "./families";
import { handoverFor } from "./handover-family";
import {
  CATALOGUE_FILE,
  catalogueChunks,
  type KnowledgeHit,
  searchCatalogue,
} from "./knowledge-notes";
import { KNOWLEDGE_DIR } from "../../packages/knowledge/constants";
import {
  isTrackId,
  keepsStyle,
  type Track,
  TRACK_IDS,
  TRACKS,
  trackMeasures,
  trackOut,
  withAgentLine,
} from "./tracks";
import { conversationStats, messageChars, type StatsRow } from "./stats";

export const TRAINING_ACTOR = "training-conversations";

export type ConversationPorts = Readonly<{
  /** Every synthetic subject_ref in the cohort, sorted. */
  listSubjects: (cohortId: string) => Promise<readonly string[]>;
  /** One audited query tool call; returns the tool's result or refusal. */
  runTool: (name: ToolName, args: unknown) => Promise<unknown>;
  systemPrompt: () => Promise<SystemPrompt>;
  /** The tools a chat request sends, as OpenAI function definitions. */
  tools: () => Promise<readonly OpenAiTool[]>;
  /**
   * For --genome: the system prompt and tools of a turn that carries the
   * genome tools (`genome_report`, `dna_ask`). Building them runs nothing.
   */
  genome?: () => Promise<
    Readonly<{ prompt: SystemPrompt; tools: readonly OpenAiTool[] }>
  >;
}>;

export type LineWriter = Readonly<{
  write: (line: string) => Promise<void>;
  close: () => Promise<void>;
}>;

export type BuildIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type BuildDeps = Readonly<{
  dataMode: () => string;
  ports: () => Promise<ConversationPorts>;
  openOut: (path: string) => Promise<LineWriter>;
  writeText: (path: string, text: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  /** A file's text, or null when it cannot be read. */
  readText: (path: string) => Promise<string | null>;
  /** The curated variant catalog (`scripts/genome-synth/variants.tsv`); read only with --genome. */
  genomeCatalog?: () => Promise<readonly Variant[]>;
  /** What the cohort's subjects are, per `is_synthetic` flag, for the consent gate (#145). */
  subjectRows: (cohortId: string) => Promise<readonly LearningRow[]>;
  learning: LearningGateDeps;
}>;

const TOOL_INPUTS = {
  ...KEYED_TOOLS,
  subject_window: subjectWindowInput,
  knowledge_search: guidelineSearchInput,
} as const;

export type BuildArgs = Readonly<{
  cohortId: string;
  out: string;
  seed: number;
  anchorDay: string;
  maxSubjects: number | null;
  families: ReadonlySet<Family>;
  allowEvalCohort: boolean;
  inlineTools: boolean;
  /** `<cohort>.rejected.json` from training:batches, summarised in the manifest. */
  rejected: string | null;
  /** Genome conversation families and the `dna_ask` tool (off by default). */
  genome: boolean;
  /** One agent's training track (`--track`), or null for the default set. */
  track: Track | null;
}>;

/** `x.jsonl` → `x.meta.jsonl`, `x.manifest.json`, `x.stats.json`. */
export const outputPaths = (out: string) => {
  const base = out.endsWith(".jsonl") ? out.slice(0, -".jsonl".length) : out;
  return {
    records: out,
    meta: `${base}.meta.jsonl`,
    manifest: `${base}.manifest.json`,
    stats: `${base}.stats.json`,
  };
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

/** The seed of a preset or 1M batch cohort; a batch cohort is named by its seed. */
const presetSeed = (cohortId: string): number | null =>
  [...Object.values(COHORT_PRESETS), ...SYNTHEA_1M_BATCH_COHORTS].find(
    (cohort) => cohort.cohortId === cohortId,
  )?.seed ?? null;

const isFamily = (name: string): name is Family =>
  ([...FAMILIES, ...GENOME_FAMILIES, ...TRACK_FAMILIES] as readonly string[]).includes(
    name,
  );

const isTrackFamily = (name: string): boolean =>
  (TRACK_FAMILIES as readonly string[]).includes(name);

const isGenomeFamily = (name: string): boolean =>
  (GENOME_FAMILIES as readonly string[]).includes(name);

/** The parsed flags, or a plain message saying what is wrong. */
export const parseBuildArgs = (argv: readonly string[]): BuildArgs | string => {
  const cohortId = flag(argv, "--cohort");
  if (!cohortId)
    return "Usage: bun run training:conversations -- --cohort <id> [--out <file>]";
  const seedText = flag(argv, "--seed");
  const seed = seedText === undefined ? presetSeed(cohortId) : Number(seedText);
  if (seed === null || !Number.isInteger(seed) || seed < 0) {
    return "--seed must be a whole number (no preset seed for this cohort).";
  }
  const anchorDay = flag(argv, "--anchor") ?? DEFAULT_END_DAY;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDay))
    return "--anchor must be a date like 2026-10-01.";
  const maxText = flag(argv, "--max-subjects");
  const maxSubjects = maxText === undefined ? null : Number(maxText);
  if (maxSubjects !== null && !(Number.isInteger(maxSubjects) && maxSubjects >= 1)) {
    return "--max-subjects must be a whole number of at least 1.";
  }
  const trackName = flag(argv, "--track");
  if (argv.includes("--track") && (trackName === undefined || !isTrackId(trackName))) {
    return `--track must be one of ${TRACK_IDS.join(", ")}.`;
  }
  const track =
    trackName !== undefined && isTrackId(trackName) ? TRACKS[trackName] : null;
  // Genome families are off unless --genome (or the genetics track): a run without it is unchanged.
  const genome = argv.includes("--genome") || track?.genome === true;
  const chosen = flag(argv, "--families");
  const names =
    chosen !== undefined
      ? chosen.split(",")
      : track !== null
        ? [...track.families, ...(genome && !track.genome ? GENOME_FAMILIES : [])]
        : [...FAMILIES, ...(genome ? GENOME_FAMILIES : [])];
  const unknown = names.filter((name) => !isFamily(name));
  if (unknown.length > 0) return `Unknown families: ${unknown.join(", ")}.`;
  if (!genome && names.some(isGenomeFamily)) {
    return "Genome families need --genome.";
  }
  if (track === null && names.some(isTrackFamily)) {
    return "The agent_handover family needs --track.";
  }
  return {
    genome,
    track,
    cohortId,
    out:
      flag(argv, "--out") ??
      (track === null
        ? `training-data/out/${cohortId}.jsonl`
        : trackOut(cohortId, track.id)),
    seed,
    anchorDay,
    maxSubjects,
    families: new Set(names.filter(isFamily)),
    allowEvalCohort: argv.includes("--allow-eval-cohort"),
    inlineTools: argv.includes("--inline-tools"),
    rejected: flag(argv, "--rejected") ?? null,
  };
};

export type RejectedSummary = Readonly<{
  count: number;
  of: number;
  reasons: Readonly<Record<string, number>>;
  file: string;
}>;

/** The counts of a `.rejected.json` file, or null when it is not one. */
export const rejectedSummary = (
  text: string | null,
  file: string,
): RejectedSummary | null => {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const count = Reflect.get(value, "rejected");
  const of = Reflect.get(value, "bundles");
  const reasons = Reflect.get(value, "reasons");
  if (
    typeof count !== "number" ||
    typeof of !== "number" ||
    typeof reasons !== "object" ||
    reasons === null ||
    !Object.values(reasons).every((n) => typeof n === "number")
  ) {
    return null;
  }
  return { count, of, reasons: { ...(reasons as Record<string, number>) }, file };
};

/** A UUID-shaped subject_ref that is not in the cohort. */
const outsideRefFor = (
  seed: number,
  subjectRef: string,
  known: ReadonlySet<string>,
): string => {
  const candidate = stableUuid(`outside:${seed}:${subjectRef}`);
  return known.has(candidate) ? stableUuid(`outside:${seed}:${subjectRef}:2`) : candidate;
};

export type BuildSummary = Readonly<{
  subjects: number;
  conversations: number;
  byFamily: Readonly<Record<string, number>>;
  byOutcome: Readonly<Record<string, number>>;
}>;

const countBy = (values: readonly string[]): Record<string, number> =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((key) => [key, values.filter((v) => v === key).length]),
  );

export const runBuildConversations = async (
  argv: readonly string[],
  io: BuildIo,
  deps: BuildDeps,
): Promise<number> => {
  if (deps.dataMode() !== "synthetic") {
    io.stderr.write("training:conversations runs only with DATA_MODE=synthetic.\n");
    return 1;
  }
  const args = parseBuildArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  if (!isAllowedCohort(args.cohortId)) {
    io.stderr.write(`Cohort "${args.cohortId}" is not an allowed synthetic cohort.\n`);
    return 1;
  }
  if (EVALUATION_COHORT_IDS.includes(args.cohortId) && !args.allowEvalCohort) {
    io.stderr.write(
      `Cohort "${args.cohortId}" is the evaluation cohort; training on it would leak the test set. Use synthea-v4-seed4242 (pass --allow-eval-cohort for a smoke run only).\n`,
    );
    return 1;
  }

  // #145: every subject must be synthetic, or covered by its owner's consent.
  const rows = await deps.subjectRows(args.cohortId);
  const permit = await requireLearningConsent("training", rows, deps.learning);
  if (!permit.ok) {
    io.stderr.write(`${learningRefusalLine(permit)}\n`);
    return 1;
  }

  const rejected =
    args.rejected === null
      ? null
      : rejectedSummary(await deps.readText(args.rejected), args.rejected);
  if (args.rejected !== null && rejected === null) {
    io.stderr.write(`--rejected ${args.rejected} is not a rejected-bundles file.\n`);
    return 1;
  }

  const ports = await deps.ports();
  if (args.genome && (deps.genomeCatalog === undefined || ports.genome === undefined)) {
    io.stderr.write("--genome needs the variant catalog and the genome turn's tools.\n");
    return 1;
  }
  const genomeCatalog =
    args.genome && deps.genomeCatalog ? await deps.genomeCatalog() : undefined;
  const prompt = await ports.systemPrompt();
  const tools = await ports.tools();
  // Genome records get the prompt and tools of a turn that carries the genome
  // tools; every other record keeps the chat's, so nothing else changes.
  const genomeTurn = args.genome && ports.genome ? await ports.genome() : null;
  const turnFor = (family: string) =>
    genomeTurn !== null && isGenomeFamily(family) ? genomeTurn : { prompt, tools };
  // A track's records carry its agent's role line, as an agent turn in the chat does.
  const { track } = args;
  const contextFor = (family: string) => {
    const turn = turnFor(family);
    return track === null
      ? turn
      : { ...turn, prompt: withAgentLine(turn.prompt, track.agent) };
  };
  const scope: TrackScope | undefined =
    track === null
      ? undefined
      : { measures: trackMeasures(track), handover: handoverFor(track) };

  const all = await ports.listSubjects(args.cohortId);
  if (all.length === 0) {
    io.stderr.write(`No subjects in cohort ${args.cohortId}.\n`);
    return 1;
  }
  const subjects = args.maxSubjects === null ? all : all.slice(0, args.maxSubjects);
  const known = new Set(all);
  const run = async (name: ToolName, toolArgs: unknown) =>
    ports.runTool(name, TOOL_INPUTS[name].parse(toolArgs));

  const paths = outputPaths(args.out);
  const partial = (path: string) => `${path}.partial`;
  const records = await deps.openOut(partial(paths.records));
  const metas = await deps.openOut(partial(paths.meta));
  const families: string[] = [];
  const outcomes: string[] = [];
  const statsRows: StatsRow[] = [];
  const wearableStart = Date.parse(`${args.anchorDay}T00:00:00Z`) - 89 * 86_400_000;
  try {
    // One subject at a time, so the audit chain reads in subject order.
    for (const subjectRef of subjects) {
      // A planning read, not part of any conversation: a subject whose records
      // end before the wearable window has no series (deceased subjects).
      const window = await run("subject_window", { subject_ref: subjectRef });
      const end = Reflect.get(Object(window), "end");
      const hasWearables = typeof end === "string" && Date.parse(end) >= wearableStart;
      const drafts = await draftsFor(
        {
          subjectRef,
          anchorDay: args.anchorDay,
          outsideRef: outsideRefFor(args.seed, subjectRef, known),
          hasWearables,
          run,
          ...(genomeCatalog === undefined ? {} : { genomeCatalog }),
        },
        (family) => randomFor(args.seed, `conversation:${subjectRef}:${family}`),
        args.families,
        scope,
      );
      for (const draft of drafts.filter((d) => keepsStyle(track, d.template.style))) {
        const record = toConversation(draft, {
          cohortId: args.cohortId,
          seed: args.seed,
          ...contextFor(draft.family),
        });
        const clean = args.inlineTools
          ? { messages: record.messages, tools: record.tools }
          : { messages: record.messages };
        await records.write(`${JSON.stringify(clean)}\n`);
        await metas.write(`${JSON.stringify(record.meta)}\n`);
        families.push(draft.family);
        outcomes.push(draft.outcome);
        statsRows.push({ meta: record.meta, chars: messageChars(record.messages) });
      }
    }
  } catch {
    await records.close();
    await metas.close();
    await deps.remove(partial(paths.records));
    await deps.remove(partial(paths.meta));
    io.stderr.write(
      "Conversations stopped: a tool call failed or its arguments did not validate. Nothing was kept.\n",
    );
    return 1;
  }
  await records.close();
  await metas.close();
  // Asked again before anything is kept: a consent withdrawn during the run stops it.
  const recheck = await requireLearningConsent("training", rows, deps.learning);
  if (!recheck.ok) {
    await deps.remove(partial(paths.records));
    await deps.remove(partial(paths.meta));
    io.stderr.write(`${learningRefusalLine(recheck, "before-write")}\n`);
    return 1;
  }
  await deps.rename(partial(paths.records), paths.records);
  await deps.rename(partial(paths.meta), paths.meta);

  const summary: BuildSummary = {
    subjects: subjects.length,
    conversations: families.length,
    byFamily: countBy(families),
    byOutcome: countBy(outcomes),
  };
  await deps.writeText(
    paths.manifest,
    `${JSON.stringify(
      {
        generator_version: GENERATOR_VERSION,
        cohort_id: args.cohortId,
        seed: args.seed,
        anchor_day: args.anchorDay,
        system_prompt_id: track === null ? prompt.id : contextFor("").prompt.id,
        // The agent this set trains (`tracks.ts`): its role line is in every system prompt.
        ...(track === null
          ? {}
          : {
              track: {
                id: track.id,
                agent_id: track.agent.id,
                agent_name: track.agent.name,
                role: track.agent.role,
                families: [...args.families],
                loincs: track.loincs,
                styles: track.styles,
              },
            }),
        files: { records: paths.records, meta: paths.meta, stats: paths.stats },
        // The consents this set relied on (#145). A synthetic set relies on none
        // and leaves the field out, so its files stay byte for byte as before.
        ...(recheck.consentIds.length === 0
          ? {}
          : { learning_consents: learningManifest(recheck) }),
        ...summary,
        // Subjects whose FHIR bundle the warehouse refused (training:batches --skip-rejected).
        ...(rejected === null ? {} : { rejected_bundles: rejected }),
        // Synthetic genotypes (scripts/genome-synth) and stand-in dna_ask results.
        ...(genomeTurn === null
          ? {}
          : {
              genome: {
                catalog_version: CATALOG_VERSION,
                system_prompt_id: contextFor(GENOME_FAMILIES[0]).prompt.id,
                tools: genomeTurn.tools,
              },
            }),
        // One copy of the tool definitions; --inline-tools also puts them on every line.
        tools,
      },
      null,
      2,
    )}\n`,
  );
  const stats = conversationStats(statsRows, JSON.stringify(tools).length);
  await deps.writeText(paths.stats, `${JSON.stringify(stats, null, 2)}\n`);
  io.stdout.write(
    [
      `Conversations written to ${paths.records} (meta in ${paths.meta})`,
      `Cohort ${args.cohortId}, seed ${args.seed}: ${summary.subjects} subjects, ${summary.conversations} conversations`,
      `By family: ${JSON.stringify(summary.byFamily)}`,
      `By outcome: ${JSON.stringify(summary.byOutcome)}`,
      `No-data share ${stats.no_data_share}, unit share ${stats.unit_share}; stats in ${paths.stats}`,
      "",
    ].join("\n"),
  );
  return 0;
};

/** The real tools, audited as `training-conversations`. Imported lazily: they need the server-only preload. */
export const realPorts = async (today: string): Promise<ConversationPorts> => {
  const tools = await import("../../packages/query-tools/tools");
  const { database } = await import("../../infrastructure/database");
  const { buildTwinSystemPrompt } =
    await import("../../features/chat/twin-system-prompt");
  const { createChatTools } = await import("../../features/chat/chat-tools");
  const { openAiToolsFrom } = await import("./chat-tool-list");
  const scope = {
    actor: TRAINING_ACTOR,
    sessionId: `${TRAINING_ACTOR}-${today}`,
    mode: "synthetic",
  } as const;
  let chunks: readonly KnowledgeHit[] | null = null;
  const catalogue = async (): Promise<readonly KnowledgeHit[]> => {
    chunks ??= catalogueChunks(
      await readFile(join(KNOWLEDGE_DIR, CATALOGUE_FILE), "utf8"),
    );
    return chunks;
  };
  const runTool = async (name: ToolName, args: unknown): Promise<unknown> => {
    switch (name) {
      case "subject_window":
        return tools.runSubjectWindow(scope, subjectWindowInput.parse(args));
      case "latest_by_loinc":
        return tools.runLatestByLoinc(scope, KEYED_TOOLS.latest_by_loinc.parse(args));
      case "trend":
        return tools.runTrend(scope, KEYED_TOOLS.trend.parse(args));
      case "baseline_deviation":
        return tools.runBaselineDeviation(
          scope,
          KEYED_TOOLS.baseline_deviation.parse(args),
        );
      case "coverage":
        return tools.runCoverage(scope, KEYED_TOOLS.coverage.parse(args));
      case "compare_windows":
        return tools.runCompareWindows(scope, KEYED_TOOLS.compare_windows.parse(args));
      case "convert_unit":
        return tools.runConvertUnit(scope, KEYED_TOOLS.convert_unit.parse(args));
      // The wearable tools read the subject's synthetic series (track families only).
      case "sleep_summary":
        return tools.runSleepSummary(scope, KEYED_TOOLS.sleep_summary.parse(args));
      case "hrv_trend":
        return tools.runHrvTrend(scope, KEYED_TOOLS.hrv_trend.parse(args));
      case "resting_hr_trend":
        return tools.runRestingHrTrend(scope, KEYED_TOOLS.resting_hr_trend.parse(args));
      case "training_load":
        return tools.runTrainingLoad(scope, KEYED_TOOLS.training_load.parse(args));
      // A stand-in over the shipped notes (knowledge-notes.ts); no embedding model runs.
      case "knowledge_search":
        return searchCatalogue(await catalogue(), guidelineSearchInput.parse(args));
    }
  };
  return {
    // Subject refs only; every number still comes through the audited tools.
    listSubjects: async (cohortId) =>
      (
        await database().subject.findMany({
          where: { cohortId, isSynthetic: true },
          select: { subjectRef: true },
          orderBy: { subjectRef: "asc" },
        })
      ).map((row) => row.subjectRef),
    runTool,
    // The chat's own tool set; building it runs nothing, only the schemas are read.
    tools: () => openAiToolsFrom(createChatTools(scope)),
    // Every tool offered and no wearable linked: the prompt a synthetic chat gets.
    systemPrompt: async () => ({
      id: "twin-system-prompt/synthetic/no-wearables",
      text: buildTwinSystemPrompt({
        mode: "synthetic",
        oura: null,
        whoop: null,
        googleHealth: null,
        vitronic: null,
      }),
    }),
    // A personal turn with the genome tools (#107), as the chat route builds it
    // once the genome policy allows a turn. Only the schemas are read: these
    // ports refuse, and the training records never run a genome tool.
    genome: async () => {
      const personal = { ...scope, mode: "personal" } as const;
      const inert = () => Promise.reject(new Error("training never runs a genome tool"));
      const chatTools = createChatTools(personal, {
        genome: {
          scope: personal,
          loadReport: inert,
          assumeBuild: null,
          windows: inert,
          ask: inert,
          appendAudit: inert,
        },
      });
      return {
        tools: await openAiToolsFrom(chatTools),
        prompt: {
          id: "twin-system-prompt/personal/genome",
          text: buildTwinSystemPrompt({
            mode: "personal",
            oura: null,
            whoop: null,
            googleHealth: null,
            vitronic: null,
            offeredTools: new Set(Object.keys(chatTools)),
          }),
        },
      };
    },
  };
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { serverEnv } = await import("../../infrastructure/env");
  const { isoLocalDate } = await import("../../infrastructure/format-measure");
  const { database } = await import("../../infrastructure/database");
  const { databaseLearningGate, warehouseSubjectRows } =
    await import("../../infrastructure/learning-consent-store");
  const code = await runBuildConversations(process.argv.slice(2), process, {
    dataMode: () => serverEnv().DATA_MODE,
    ports: () => realPorts(isoLocalDate()),
    openOut: async (path) => {
      await mkdir(dirname(path), { recursive: true });
      const stream = createWriteStream(path);
      return {
        write: (line) =>
          new Promise<void>((done, fail) =>
            stream.write(line, (error) => (error ? fail(error) : done())),
          ),
        close: () => new Promise<void>((done) => stream.end(done)),
      };
    },
    writeText: (path, text) => writeFile(path, text),
    rename: (from, to) => rename(from, to),
    remove: (path) => rm(path, { force: true }),
    readText: (path) => readFile(path, "utf8").catch(() => null),
    genomeCatalog: async () =>
      (await import("../genome-synth/read-catalog")).readCatalog(),
    subjectRows: (cohortId) => warehouseSubjectRows([cohortId]),
    learning: databaseLearningGate(),
  });
  await database().$disconnect();
  process.exit(code);
}
