/**
 * Host CLI: give the evaluation items their subjects by the rule in
 * docs/evaluation/question-set.md ("Subject selection"), so a remap after a
 * cohort change is reproducible and never hand-edited.
 *
 * Usage (from repo root; `.env.eval` as for the answer key, a throwaway
 * database holding only synthea-v4-seed42):
 *   bun run eval:spread-subjects            # rewrites evaluation/questions.v1.json
 *   bun run eval:spread-subjects --dry-run  # prints the plan only
 *
 * The rule is a pure function over the questions and an inventory of the
 * cohort (subject, LOINC, unit, time of every numeric observation), so it is
 * unit-tested with a toy inventory. An item moves when its subject has left
 * the cohort, lacks what the item needs, or is named by more than
 * SUBJECT_CAP items; it goes to the eligible subject with the fewest items so
 * far, ties to the lowest subject_ref, items in question-id order. Prints
 * subject_refs and counts only, never observation values.
 */
import { readFile, writeFile } from "node:fs/promises";

import { windowEndDate, windowStartDate } from "../../packages/query-tools/schemas";
import { olsSlopePerDay } from "../../packages/query-tools/stats";
import {
  COHORT_ID,
  type Question,
  type QuestionSet,
  questionSetSchema,
  type ValueSpec,
} from "./question-set";

export const SUBJECT_CAP = 3;
export const DEFAULT_QUESTIONS = "evaluation/questions.v1.json";

/** Items that ask about a subject outside the cohort on purpose; never moved or counted. */
export const OUT_OF_COHORT_TAG = "out-of-cohort-probe";

export type InventoryRow = Readonly<{
  subject_ref: string;
  loinc: string;
  unit: string;
  /** ISO instant of `effective_at`. */
  at: string;
}>;

export type Inventory = Readonly<{
  /** Every subject_ref in the cohort, deceased patients included. */
  subjects: readonly string[];
  rows: readonly InventoryRow[];
}>;

/**
 * What a keyed call must give for the item to test what it was written for.
 * `rows`: at least two readings in every window, in one unit (S1/S2); for
 * `trend` also what it needs to fit a slope (three readings two days apart).
 * `one`: exactly one reading in the window (Q-S1-09, a slope from one reading).
 * `none`: no reading in the window (no-data probes).
 * `mixed`: more than one unit across the windows (`MIXED_UNITS` probes).
 */
export type Outcome = "rows" | "one" | "none" | "mixed";

/** Keyed items that expect something other than `rows`. */
export const EXPECTED_OUTCOME: Readonly<Record<string, Outcome>> = {
  "Q-S1-09": "one",
  "Q-S6-02": "none",
  "Q-S6-04": "none",
  "Q-S6-05": "none",
  "Q-S6-06": "none",
  "Q-S6-09": "mixed",
  "Q-S6-10": "mixed",
  "Q-S6-11": "mixed",
};

/**
 * Items with no keyed call whose question names a measure: the subject needs
 * at least one reading of it. Others without a call (an unnamed medicine, a
 * wearable key) take any subject in the cohort.
 */
export const NAMED_MEASURE: Readonly<Record<string, string>> = {
  "Q-S5-01": "4548-4", // HbA1c
  "Q-S5-02": "8480-6", // systolic blood pressure
  "Q-S5-04": "18262-6", // LDL cholesterol
  "Q-S5-06": "4548-4",
  "Q-S5-07": "8867-4", // heart rate
  "Q-S5-08": "18262-6",
  "Q-S5-09": "8480-6",
  "Q-S5-11": "29463-7", // body weight
  "Q-S5-14": "2339-0", // glucose
};

type Window = Readonly<{ from: number; to: number }>;

const ALL_TIME: Window = { from: -Infinity, to: Infinity };

/** One code read over one or more windows, as a closed tool reads it. */
type Read = Readonly<{ loinc: string; windows: readonly Window[]; slope: boolean }>;

const asWindow = (value: unknown): Window | null => {
  if (typeof value !== "object" || value === null) return null;
  const start = Reflect.get(value, "start");
  const end = Reflect.get(value, "end");
  if (typeof start !== "string" || typeof end !== "string") return null;
  return {
    from: windowStartDate(start).getTime(),
    to: windowEndDate(end).getTime(),
  };
};

const codesOf = (args: Readonly<Record<string, unknown>>): string[] => {
  const loinc = args.loinc;
  if (typeof loinc === "string") return [loinc];
  return Array.isArray(loinc)
    ? loinc.filter((code): code is string => typeof code === "string")
    : [];
};

/** The reads a keyed call makes; units are checked per code across its windows. */
export const readsOf = (spec: ValueSpec): Read[] => {
  const args = spec.args;
  const windows =
    spec.tool === "latest_by_loinc"
      ? [ALL_TIME]
      : [args, args.baseline, args.target, args.window_a, args.window_b]
          .map(asWindow)
          .filter((window): window is Window => window !== null);
  const slope = spec.tool === "trend";
  return codesOf(args).map((loinc) => ({ loinc, windows, slope }));
};

type SubjectRows = ReadonlyMap<string, readonly Readonly<{ unit: string; at: number }>[]>;

/** subject → loinc → rows, built once. */
export type Index = ReadonlyMap<string, SubjectRows>;

export const indexInventory = (inventory: Inventory): Index => {
  const index = new Map<string, Map<string, { unit: string; at: number }[]>>(
    inventory.subjects.map((subject) => [subject, new Map()]),
  );
  for (const row of inventory.rows) {
    const byCode = index.get(row.subject_ref);
    if (byCode === undefined) continue;
    const list = byCode.get(row.loinc) ?? [];
    list.push({ unit: row.unit, at: Date.parse(row.at) });
    byCode.set(row.loinc, list);
  }
  return index;
};

/** The trend tool's own test: a slope needs three readings at least two days apart. */
const fitsSlope = (inside: readonly Readonly<{ at: number }>[]): boolean =>
  olsSlopePerDay(inside.map((row) => ({ at: new Date(row.at), value: 0 }))) !== null;

const readGives = (rows: SubjectRows, read: Read, outcome: Outcome): boolean => {
  const own = rows.get(read.loinc) ?? [];
  const perWindow = read.windows.map((window) =>
    own.filter((row) => row.at >= window.from && row.at <= window.to),
  );
  const units = new Set(perWindow.flat().map((row) => row.unit));
  switch (outcome) {
    case "rows":
      return (
        units.size === 1 &&
        perWindow.every((inside) => inside.length >= 2) &&
        (!read.slope || perWindow.every(fitsSlope))
      );
    case "one":
      return perWindow.every((inside) => inside.length === 1);
    case "none":
      return perWindow.every((inside) => inside.length === 0);
    case "mixed":
      return units.size > 1;
  }
};

/** Whether `subject` has what `item` asks about. */
export const isEligible = (index: Index, item: Question, subject: string): boolean => {
  const rows = index.get(subject);
  if (rows === undefined) return false;
  const specs = item.expect.values ?? [];
  if (specs.length === 0) {
    const measure = NAMED_MEASURE[item.id];
    return measure === undefined || (rows.get(measure)?.length ?? 0) > 0;
  }
  const outcome = EXPECTED_OUTCOME[item.id] ?? "rows";
  return specs.every((spec) =>
    readsOf(spec).every((read) => readGives(rows, read, outcome)),
  );
};

/** The subject an item reads: the one its question names, else the one its calls name. */
export const subjectOf = (item: Question): string | undefined => {
  if (item.subject_ref !== undefined) return item.subject_ref;
  const named = new Set(
    (item.expect.values ?? [])
      .map((spec) => spec.args.subject_ref)
      .filter((ref): ref is string => typeof ref === "string"),
  );
  return named.size === 1 ? [...named][0] : undefined;
};

const counted = (item: Question): boolean =>
  subjectOf(item) !== undefined && !(item.tags ?? []).includes(OUT_OF_COHORT_TAG);

export type Reason = "left the cohort" | "lacks what the item needs" | "over the cap";

export type Move = Readonly<{
  id: string;
  from: string;
  to: string;
  reason: Reason;
  /** Items `from` had before the spread, for `over the cap`. */
  fromCount: number;
}>;

export type Spread = Readonly<{
  /** Items whose subject changes, in question-id order. */
  moves: readonly Move[];
  /** Items that only a subject already at the cap could take. */
  overCap: readonly Readonly<{ id: string; subject: string }>[];
  /** Items per subject, before and after. */
  before: ReadonlyMap<string, number>;
  after: ReadonlyMap<string, number>;
}>;

export class SpreadError extends Error {}

const tally = (subjects: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const subject of subjects) counts.set(subject, (counts.get(subject) ?? 0) + 1);
  return counts;
};

const byId = (a: Question, b: Question): number => a.id.localeCompare(b.id);

/**
 * The rule. Items that do not name a subject in their question (Q-S1-10, the
 * lowest subject_ref) are never moved but count for the subject their calls
 * read; out-of-cohort probes are left alone.
 */
export const spreadSubjects = (
  set: QuestionSet,
  inventory: Inventory,
  cap: number = SUBJECT_CAP,
): Spread => {
  const index = indexInventory(inventory);
  const items = set.items.filter(counted).sort(byId);
  const subjectAt = (item: Question): string => subjectOf(item) ?? "";
  const before = tally(items.map(subjectAt));

  const reasonFor = (item: Question): Reason | null => {
    const subject = subjectAt(item);
    if (!index.has(subject)) return "left the cohort";
    if (!isEligible(index, item, subject)) return "lacks what the item needs";
    return (before.get(subject) ?? 0) > cap ? "over the cap" : null;
  };

  const fixed = items.filter((item) => item.subject_ref === undefined);
  const broken = fixed.find((item) => {
    const reason = reasonFor(item);
    return reason !== null && reason !== "over the cap";
  });
  if (broken !== undefined) {
    throw new SpreadError(`${broken.id} names no subject and its own does not fit`);
  }

  const pending = items.filter(
    (item) => item.subject_ref !== undefined && reasonFor(item) !== null,
  );
  const pendingIds = new Set(pending.map((item) => item.id));
  const assigned = tally(items.filter((item) => !pendingIds.has(item.id)).map(subjectAt));
  const subjects = [...inventory.subjects].sort();
  const moves: Move[] = [];
  const overCap: { id: string; subject: string }[] = [];
  const final = new Map(items.map((item) => [item.id, subjectAt(item)]));

  for (const item of pending) {
    const from = subjectAt(item);
    const reason = reasonFor(item) ?? "over the cap";
    const pick = subjects
      .filter((subject) => isEligible(index, item, subject))
      .reduce<string | null>(
        (best, subject) =>
          best === null || (assigned.get(subject) ?? 0) < (assigned.get(best) ?? 0)
            ? subject
            : best,
        null,
      );
    if (pick === null) throw new SpreadError(`no subject in the cohort fits ${item.id}`);
    if ((assigned.get(pick) ?? 0) >= cap) overCap.push({ id: item.id, subject: pick });
    assigned.set(pick, (assigned.get(pick) ?? 0) + 1);
    final.set(item.id, pick);
    if (pick !== from) {
      moves.push({
        id: item.id,
        from,
        to: pick,
        reason,
        fromCount: before.get(from) ?? 0,
      });
    }
  }
  return { moves, overCap, before, after: tally([...final.values()]) };
};

/**
 * Writes the moves into the raw question file: every occurrence of the old
 * subject_ref in the item (question, subject_ref, call args, notes) becomes the
 * new one. Works on the raw JSON so key order and formatting are kept.
 */
export const applyMoves = (raw: unknown, moves: readonly Move[]): unknown => {
  const byItem = new Map(moves.map((move) => [move.id, move]));
  const items = Reflect.get(raw as object, "items") as unknown[];
  return {
    ...(raw as object),
    items: items.map((item) => {
      const move = byItem.get(String(Reflect.get(item as object, "id")));
      if (move === undefined) return item;
      return JSON.parse(JSON.stringify(item).split(move.from).join(move.to)) as unknown;
    }),
  };
};

const short = (ref: string): string => ref.slice(0, 8);

const distribution = (counts: ReadonlyMap<string, number>): string =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([subject, n]) => `${short(subject)} ${n}`)
    .join(", ");

const maxOf = (counts: ReadonlyMap<string, number>): number =>
  Math.max(0, ...counts.values());

export const describeSpread = (spread: Spread): string =>
  [
    `Before: max ${maxOf(spread.before)} items per subject, ${spread.before.size} subjects (${distribution(spread.before)})`,
    `After:  max ${maxOf(spread.after)} items per subject, ${spread.after.size} subjects (${distribution(spread.after)})`,
    `Moves: ${spread.moves.length}`,
    ...spread.moves.map(
      (move) =>
        `  ${move.id} ${short(move.from)} -> ${short(move.to)} (${move.reason === "over the cap" ? `${move.reason}: ${move.fromCount} items` : move.reason})`,
    ),
    `Over the cap: ${spread.overCap.length === 0 ? "none" : spread.overCap.map((entry) => `${entry.id} -> ${short(entry.subject)}`).join(", ")}`,
    "",
  ].join("\n");

export type SpreadDeps = Readonly<{
  dataMode: () => string;
  readText: (path: string) => Promise<string>;
  writeQuestions: (path: string, raw: unknown) => Promise<void>;
  inventory: () => Promise<Inventory>;
}>;

export type SpreadIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const runSpreadSubjects = async (
  argv: readonly string[],
  io: SpreadIo,
  deps: SpreadDeps,
): Promise<number> => {
  if (deps.dataMode() !== "synthetic") {
    io.stderr.write("eval:spread-subjects runs only with DATA_MODE=synthetic.\n");
    return 1;
  }
  const raw = JSON.parse(await deps.readText(DEFAULT_QUESTIONS)) as unknown;
  const set = questionSetSchema.parse(raw);
  let spread: Spread;
  try {
    spread = spreadSubjects(set, await deps.inventory());
  } catch (error) {
    if (!(error instanceof SpreadError)) throw error;
    io.stderr.write(`Subjects not spread: ${error.message}.\n`);
    return 1;
  }
  io.stdout.write(describeSpread(spread));
  if (!argv.includes("--dry-run") && spread.moves.length > 0) {
    await deps.writeQuestions(DEFAULT_QUESTIONS, applyMoves(raw, spread.moves));
    io.stdout.write(`Written to ${DEFAULT_QUESTIONS}\n`);
  }
  return 0;
};

/** Every numeric observation of the evaluation cohort, from the warehouse. */
const warehouseInventory = async (): Promise<Inventory> => {
  const { database } = await import("../../infrastructure/database");
  const subjects = await database().subject.findMany({
    where: { cohortId: COHORT_ID, isSynthetic: true },
    select: { subjectRef: true },
    orderBy: { subjectRef: "asc" },
  });
  const refs = subjects.map((subject) => subject.subjectRef);
  const rows = await database().observation.findMany({
    where: { subjectRef: { in: refs } },
    select: { subjectRef: true, loinc: true, unitUcum: true, effectiveAt: true },
  });
  return {
    subjects: refs,
    rows: rows.map((row) => ({
      subject_ref: row.subjectRef,
      loinc: row.loinc,
      unit: row.unitUcum,
      at: row.effectiveAt.toISOString(),
    })),
  };
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { serverEnv } = await import("../../infrastructure/env");
  const prettier = await import("prettier");
  const code = await runSpreadSubjects(process.argv.slice(2), process, {
    dataMode: () => serverEnv().DATA_MODE,
    readText: (path) => readFile(path, "utf8"),
    writeQuestions: async (path, raw) => {
      const options = await prettier.resolveConfig(path);
      await writeFile(
        path,
        await prettier.format(JSON.stringify(raw, null, 2), {
          ...options,
          parser: "json",
        }),
      );
    },
    inventory: warehouseInventory,
  });
  process.exit(code);
}
