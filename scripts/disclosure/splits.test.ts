import { describe, expect, test } from "bun:test";
import { mulberry32 } from "@/infrastructure/seeded-random";
import {
  buildControlSets,
  buildPilotSets,
  sampleProbes,
  shuffled,
  type Conversation,
} from "./splits";

const FAMILIES = [
  "latest_value",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
];

/** Subjects s0..s(n-1), one conversation per analytics family, plus a refusal each. */
const cohort = (n: number): Conversation[] =>
  Array.from({ length: n }, (_, s) => [
    ...FAMILIES.map((family, f) => ({ line: s * 10 + f, subject: `s${s}`, family })),
    { line: s * 10 + 5, subject: `s${s}`, family: "decline_dose" },
  ]).flat();

describe("shuffled", () => {
  test("is a seeded permutation that leaves the input alone", () => {
    const items = [1, 2, 3, 4, 5];
    const a = shuffled(items, mulberry32(7));
    expect(a).toEqual(shuffled(items, mulberry32(7)));
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("buildPilotSets", () => {
  // s0..s3 have their trend conversation in training; s4 only a refusal; s5..s9 nothing.
  const conversations = cohort(10);
  const trained = new Set([1, 11, 21, 31, 45]);

  test("members were trained on, non-members never appear in training", () => {
    const sets = buildPilotSets(conversations, trained, 3, 1);
    expect(sets.memberPool).toBe(4);
    expect(sets.nonMemberPool).toBe(5);
    const members = sets.items.filter((i) => i.member).map((i) => i.subject);
    const nonMembers = sets.items.filter((i) => !i.member).map((i) => i.subject);
    expect(members.every((s) => ["s0", "s1", "s2", "s3"].includes(s))).toBe(true);
    expect(nonMembers.every((s) => ["s5", "s6", "s7", "s8", "s9"].includes(s))).toBe(
      true,
    );
    expect(sets.items.length).toBe(12);
  });

  test("record items are trained lines, subject items are not, and pairs share a family", () => {
    const sets = buildPilotSets(conversations, trained, 4, 2);
    const record = sets.items.filter((i) => i.level === "record");
    const subject = sets.items.filter((i) => i.level === "subject");
    expect(record.filter((i) => i.member).every((i) => trained.has(i.line))).toBe(true);
    expect(record.filter((i) => i.member).every((i) => i.family === "trend")).toBe(true);
    expect(subject.every((i) => !trained.has(i.line))).toBe(true);
    for (const level of [record, subject]) {
      for (const pair of new Set(level.map((i) => i.pair))) {
        const [a, b] = level.filter((i) => i.pair === pair);
        expect(a.family).toBe(b.family);
        expect(a.member).not.toBe(b.member);
      }
    }
  });

  test("the same seed gives the same sets", () => {
    expect(buildPilotSets(conversations, trained, 3, 9)).toEqual(
      buildPilotSets(conversations, trained, 3, 9),
    );
  });
});

describe("buildControlSets", () => {
  const conversations = cohort(12);

  test("trains on every conversation of the members except one held out each", () => {
    const sets = buildControlSets(conversations, new Set(["s0", "s1"]), 3, 4);
    expect(sets.members.length).toBe(3);
    expect(sets.nonMembers.length).toBe(3);
    expect(sets.members.some((s) => s === "s0" || s === "s1")).toBe(false);
    expect(sets.members.filter((s) => sets.nonMembers.includes(s))).toEqual([]);
    expect(sets.trainLines.length).toBe(3 * 6 - 3);
    expect(sets.heldOutLines.length).toBe(3);
    expect(sets.heldOutLines.some((line) => sets.trainLines.includes(line))).toBe(false);
    const subjectMembers = sets.items.filter((i) => i.level === "subject" && i.member);
    expect(subjectMembers.map((i) => i.line).sort((a, b) => a - b)).toEqual(
      sets.heldOutLines,
    );
    const recordMembers = sets.items.filter((i) => i.level === "record" && i.member);
    expect(recordMembers.every((i) => sets.trainLines.includes(i.line))).toBe(true);
  });
});

describe("sampleProbes", () => {
  test("takes up to size of each class with stable ids", () => {
    const probes = sampleProbes("x", [5, 3, 9], [1, 2], 2, 3);
    expect(probes.length).toBe(4);
    expect(probes.filter((p) => p.member).map((p) => p.id)).toEqual([
      "x-probe-0-m",
      "x-probe-1-m",
    ]);
    expect(
      probes
        .filter((p) => !p.member)
        .map((p) => p.line)
        .sort(),
    ).toEqual([1, 2]);
    expect(probes.filter((p) => p.member).every((p) => [5, 3, 9].includes(p.line))).toBe(
      true,
    );
  });
});
