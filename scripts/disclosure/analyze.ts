/**
 * Step 5 of the disclosure experiment (#301): attack scores, AUROC, TPR at 1%
 * FPR and the value-probe match rates from the files the GPU steps wrote.
 *
 *   bun scripts/disclosure/analyze.ts --run ../twin-llm-disclosure-run
 *
 * Writes `<run>/summary.json` and `<run>/report.md`. A model whose files are
 * missing is skipped and listed. Prints tables of rates, never a conversation.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { attackScore } from "./metrics";
import {
  analyseModel,
  analyseProbes,
  attackTable,
  pearson,
  probeTable,
  tokenScores,
  type ItemRow,
  type ProbeResult,
  type ProbeRow,
  type ScoreRow,
} from "./report";

const { values: args } = parseArgs({
  options: {
    run: { type: "string" },
    resamples: { type: "string", default: "1000" },
    permutations: { type: "string", default: "9999" },
    seed: { type: "string", default: "301" },
  },
});
if (!args.run) throw new Error("--run <run dir> is required");
const run = resolve(args.run);
const resamples = Number(args.resamples);
const permutations = Number(args.permutations);
const seed = Number(args.seed);

const MODELS = [
  {
    key: "pilot-checkpoint",
    name: "Pilot 1, training checkpoint (4-bit base + LoRA)",
    items: "pilot-items",
    target: "pilot-adapter",
    reference: "base-4bit",
  },
  {
    key: "pilot-served",
    name: "Pilot 1, served export (q4_K_M weights)",
    items: "pilot-items",
    target: "pilot-q4km",
    reference: "base-q4km",
  },
  {
    key: "control",
    name: "Positive control (4-bit base + LoRA, overfit)",
    items: "control-items",
    target: "control-adapter",
    reference: "base-4bit",
  },
  {
    key: "control-vs-pilot",
    name: "Positive control, with pilot 1 as the reference model",
    items: "control-items",
    target: "control-adapter",
    reference: "pilot-adapter",
  },
] as const;

const PROBES = [
  {
    key: "pilot-checkpoint",
    name: "Pilot 1 checkpoint",
    probes: "pilot-probes",
    model: "pilot-adapter",
  },
  {
    key: "base-checkpoint",
    name: "Base checkpoint",
    probes: "pilot-probes",
    model: "base-4bit",
  },
  {
    key: "pilot-ollama",
    name: "Pilot 1 served by Ollama",
    probes: "pilot-probes",
    model: "pilot-ollama",
  },
  {
    key: "base-ollama",
    name: "Base served by Ollama",
    probes: "pilot-probes",
    model: "base-ollama",
  },
  {
    key: "control",
    name: "Positive control",
    probes: "control-probes",
    model: "control-adapter",
  },
  {
    key: "control-base",
    name: "Base checkpoint, control probes",
    probes: "control-probes",
    model: "base-4bit",
  },
  ...[
    ["pilot-adapter", "Pilot 1 checkpoint", "pilot-probes"],
    ["base-4bit", "Base checkpoint", "pilot-probes"],
    ["pilot-ollama", "Pilot 1 served by Ollama", "pilot-probes"],
    ["base-ollama", "Base served by Ollama", "pilot-probes"],
    ["control-adapter", "Positive control", "control-probes"],
    ["base-4bit", "Base checkpoint, control probes", "control-probes"],
  ].map(([model, name, probes]) => ({
    key: `${model}-${probes}-prefill`,
    name: `${name}, completion`,
    probes,
    model: `${model}-prefill`,
  })),
];

const readJsonl = async <T>(path: string): Promise<T[]> =>
  (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as T);

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]));

const skipped: string[] = [];
const attacks: Record<string, unknown> = {};
const sections: string[] = [];
const scoreFile = (model: string, items: string) =>
  join(run, "scores", model, `${items}.jsonl`);

for (const model of MODELS) {
  const targetPath = scoreFile(model.target, model.items);
  const referencePath = scoreFile(model.reference, model.items);
  if (!existsSync(targetPath) || !existsSync(referencePath)) {
    skipped.push(model.key);
    continue;
  }
  const items = await readJsonl<ItemRow>(join(run, "sets", `${model.items}.jsonl`));
  const result = analyseModel(
    items,
    byId(await readJsonl<ScoreRow>(targetPath)),
    byId(await readJsonl<ScoreRow>(referencePath)),
    resamples,
    seed,
  );
  attacks[model.key] = result;
  sections.push(`### ${model.name}\n\n${attackTable(result)}`);
}

// Checkpoint against served: do the two sets of weights rank conversations alike?
const agreement: Record<string, number | null> = {};
const pairs = [["pilot-adapter", "base-4bit", "pilot-q4km", "base-q4km"]] as const;
for (const [t1, r1, t2, r2] of pairs) {
  const paths = [t1, r1, t2, r2].map((m) => scoreFile(m, "pilot-items"));
  if (!paths.every((p) => existsSync(p))) continue;
  const [a, b, c, d] = await Promise.all(
    paths.map((p) => readJsonl<ScoreRow>(p).then(byId)),
  );
  const ids = [...a.keys()].filter((id) => b.has(id) && c.has(id) && d.has(id));
  for (const attack of ["loss", "reference"] as const) {
    const x = ids.map(
      (id) => attackScore(attack, tokenScores(a.get(id)!), tokenScores(b.get(id)!)) ?? 0,
    );
    const y = ids.map(
      (id) => attackScore(attack, tokenScores(c.get(id)!), tokenScores(d.get(id)!)) ?? 0,
    );
    agreement[`${attack}: checkpoint vs served`] = pearson(x, y);
  }
}

const probes: Record<string, ProbeResult> = {};
for (const probe of PROBES) {
  const answersPath = join(run, "probes", probe.model, `${probe.probes}.jsonl`);
  if (!existsSync(answersPath)) {
    skipped.push(`probe:${probe.key}`);
    continue;
  }
  const rows = await readJsonl<ProbeRow>(join(run, "sets", `${probe.probes}.jsonl`));
  const answers = await readJsonl<{ id: string; answer: string }>(answersPath);
  probes[probe.name] = analyseProbes(
    rows,
    new Map(answers.map((a) => [a.id, a.answer])),
    permutations,
    seed,
  );
}

const summary = {
  issue: 301,
  resamples,
  permutations,
  seed,
  attacks,
  agreement,
  probes,
  skipped,
};
await writeFile(join(run, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const report = [
  "## Membership inference",
  ...sections,
  "## Checkpoint against served weights (Pearson r of per-conversation scores)",
  Object.entries(agreement)
    .map(([k, v]) => `- ${k}: ${v === null ? "n/a" : v.toFixed(3)}`)
    .join("\n") || "- not scored",
  "## Exact-value extraction probe",
  probeTable(Object.entries(probes)),
  skipped.length > 0 ? `Skipped (files missing): ${skipped.join(", ")}` : "",
].join("\n\n");
await writeFile(join(run, "report.md"), report + "\n");
console.log(report);
