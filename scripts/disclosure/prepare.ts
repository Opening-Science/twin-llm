/**
 * Step 1 of the disclosure experiment (#301): draw the member and non-member
 * sets, the positive control's training file and the value probes.
 *
 *   bun scripts/disclosure/prepare.ts --out ../twin-llm-disclosure-run
 *
 * Reads the pilot's data splits and the synthetic training cohort
 * (synthea-v4-seed1001), never anything else, and asks the learning-consent
 * gate (#145) for every meta line before using any. Writes `<out>/sets/` and
 * `<out>/sets/manifest.json` (seeds, counts, sha256 of every input). Prints
 * counts, never a conversation.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  learningRefusalLine,
  noConsentStore,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";
import { splitRows } from "../training-data/split-conversations";

import {
  buildControlSets,
  buildPilotSets,
  sampleProbes,
  type Conversation,
  type ProbeSlot,
  type ScoreItem,
} from "./splits";
import { probeTruth, type ChatMessage } from "./values";

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    pilot: { type: "string", default: "/home/mia/Projects/finetune-pilot" },
    cohort: {
      type: "string",
      default: "/home/mia/Projects/twin-llm-215/training-data/out/synthea-v4-seed1001",
    },
    size: { type: "string", default: "500" },
    "control-size": { type: "string", default: "40" },
    probes: { type: "string", default: "200" },
    seed: { type: "string", default: "301" },
  },
});
if (!args.out) throw new Error("--out <run dir> is required");
if (!args.cohort.endsWith("synthea-v4-seed1001"))
  throw new Error(
    "the pilot was trained on synthea-v4-seed1001; refusing another cohort",
  );

const out = resolve(args.out);
const seed = Number(args.seed);
const size = Number(args.size);
const controlSize = Number(args["control-size"]);
const probeCount = Number(args.probes);

const sha256 = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

type Meta = Readonly<{ family: string; subject_ref: string | null; synthetic: boolean }>;

const cohortText = await readFile(`${args.cohort}.jsonl`, "utf8");
const metaText = await readFile(`${args.cohort}.meta.jsonl`, "utf8");
const trainText = await readFile(join(args.pilot, "data/train.jsonl"), "utf8");
const valText = await readFile(join(args.pilot, "data/val.jsonl"), "utf8");

const records = lines(cohortText);
const metas = lines(metaText).map((line) => JSON.parse(line) as Meta);
if (records.length !== metas.length) throw new Error("cohort and meta differ in length");
// #145: every conversation must come from a synthetic subject of a listed cohort.
// This command reads files only, so it has no consent store: a personal row is refused.
const permit = await requireLearningConsent(
  "training",
  splitRows(metas),
  noConsentStore(),
);
if (!permit.ok) {
  process.stderr.write(`${learningRefusalLine(permit)}\n`);
  process.exit(1);
}

const conversations: Conversation[] = metas.flatMap((m, line) =>
  m.subject_ref ? [{ line, subject: m.subject_ref, family: m.family }] : [],
);
const trainedLines = new Set(
  lines(trainText).map((line) => (JSON.parse(line) as { line: number }).line),
);
const valLines = lines(valText).map(
  (line) => (JSON.parse(line) as { line: number }).line,
);

const messagesAt = (line: number): ChatMessage[] =>
  (JSON.parse(records[line]) as { messages: ChatMessage[] }).messages;

// ---- the pilot fine-tune ----
const pilot = buildPilotSets(conversations, trainedLines, size, seed);
const trainedSubjects = new Set(
  conversations.filter((c) => trainedLines.has(c.line)).map((c) => c.subject),
);
const pilotSubjects = new Set(pilot.items.map((i) => i.subject));

// ---- the positive control ----
const control = buildControlSets(
  conversations,
  new Set([...trainedSubjects, ...pilotSubjects]),
  controlSize,
  seed + 1,
);
const controlTrain = new Set(control.trainLines);

// ---- value probes on latest-value conversations with a numeric answer ----
const withTruth = (line: number): boolean => probeTruth(messagesAt(line)) !== null;
const latest = conversations.filter((c) => c.family === "latest_value");
const pilotProbes = sampleProbes(
  "pilot",
  latest.filter((c) => trainedLines.has(c.line) && withTruth(c.line)).map((c) => c.line),
  latest
    .filter((c) => !trainedSubjects.has(c.subject) && withTruth(c.line))
    .map((c) => c.line),
  probeCount,
  seed + 2,
);
const controlMembers = new Set(control.members);
const controlNonMembers = new Set(control.nonMembers);
const controlProbes = sampleProbes(
  "control",
  latest
    .filter(
      (c) =>
        controlMembers.has(c.subject) && controlTrain.has(c.line) && withTruth(c.line),
    )
    .map((c) => c.line),
  latest
    .filter((c) => controlNonMembers.has(c.subject) && withTruth(c.line))
    .map((c) => c.line),
  controlSize,
  seed + 3,
);

const jsonl = (rows: readonly unknown[]): string =>
  rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const itemRows = (items: readonly ScoreItem[]) =>
  items.map((item) => ({ ...item, messages: messagesAt(item.line) }));
const probeRows = (probes: readonly ProbeSlot[]) =>
  probes.map((probe) => {
    const truth = probeTruth(messagesAt(probe.line));
    return { ...probe, subject: metas[probe.line].subject_ref, ...truth };
  });

const dir = join(out, "sets");
await mkdir(dir, { recursive: true });
const files: Record<string, string> = {
  "pilot-items.jsonl": jsonl(itemRows(pilot.items)),
  "control-items.jsonl": jsonl(itemRows(control.items)),
  "control-train.jsonl": jsonl(
    control.trainLines.map((line) => ({ line, messages: messagesAt(line) })),
  ),
  "control-val.jsonl": jsonl(
    control.items
      .filter((i) => i.level === "record" && !i.member)
      .map((i) => ({ line: i.line, messages: messagesAt(i.line) })),
  ),
  "pilot-probes.jsonl": jsonl(probeRows(pilotProbes)),
  "control-probes.jsonl": jsonl(probeRows(controlProbes)),
};
for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);

const count = (items: readonly ScoreItem[], level: string, member: boolean) =>
  items.filter((i) => i.level === level && i.member === member).length;
const manifest = {
  issue: 301,
  seed,
  seeds: {
    pilotSets: seed,
    controlSets: seed + 1,
    pilotProbes: seed + 2,
    controlProbes: seed + 3,
  },
  inputs: {
    cohort: { path: `${args.cohort}.jsonl`, sha256: sha256(cohortText) },
    meta: { path: `${args.cohort}.meta.jsonl`, sha256: sha256(metaText) },
    pilotTrain: { path: join(args.pilot, "data/train.jsonl"), sha256: sha256(trainText) },
    pilotVal: { path: join(args.pilot, "data/val.jsonl"), sha256: sha256(valText) },
  },
  cohort: {
    conversations: records.length,
    subjects: new Set(conversations.map((c) => c.subject)).size,
  },
  pilot: {
    trainedConversations: trainedLines.size,
    trainedSubjects: trainedSubjects.size,
    valConversations: valLines.length,
    memberPool: pilot.memberPool,
    nonMemberPool: pilot.nonMemberPool,
    record: {
      members: count(pilot.items, "record", true),
      nonMembers: count(pilot.items, "record", false),
    },
    subject: {
      members: count(pilot.items, "subject", true),
      nonMembers: count(pilot.items, "subject", false),
    },
    probes: {
      members: pilotProbes.filter((p) => p.member).length,
      nonMembers: pilotProbes.filter((p) => !p.member).length,
    },
  },
  control: {
    members: control.members.length,
    nonMembers: control.nonMembers.length,
    trainConversations: control.trainLines.length,
    heldOutConversations: control.heldOutLines.length,
    record: {
      members: count(control.items, "record", true),
      nonMembers: count(control.items, "record", false),
    },
    subject: {
      members: count(control.items, "subject", true),
      nonMembers: count(control.items, "subject", false),
    },
    probes: {
      members: controlProbes.filter((p) => p.member).length,
      nonMembers: controlProbes.filter((p) => !p.member).length,
    },
  },
  files: Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, sha256(text)]),
  ),
};
await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({ pilot: manifest.pilot, control: manifest.control }, null, 2),
);
