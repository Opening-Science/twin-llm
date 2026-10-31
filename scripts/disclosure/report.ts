/**
 * Joins scored conversations and probe answers into results, and renders the
 * tables of the write-up (#301). Pure.
 */
import { mulberry32 } from "@/infrastructure/seeded-random";
import {
  ATTACKS,
  attackScore,
  compareMatches,
  evaluateAttack,
  type Attack,
  type AttackResult,
  type MatchComparison,
  type TokenScores,
} from "./metrics";
import { type Level } from "./splits";
import { statesValue } from "./values";

export type ItemRow = Readonly<{
  id: string;
  level: Level;
  member: boolean;
  subject: string;
}>;

export type ScoreRow = Readonly<{
  id: string;
  n: number;
  lp: readonly number[];
  digit: readonly number[];
  zlib: number;
}>;

export const tokenScores = (row: ScoreRow): TokenScores => ({
  lp: row.lp,
  digit: row.digit.map((flag) => flag === 1),
  zlibBytes: row.zlib,
});

export type AttackCell = AttackResult & Readonly<{ missing: number }>;

export type ModelResult = Readonly<Record<Level, Readonly<Record<Attack, AttackCell>>>>;

const LEVELS: readonly Level[] = ["record", "subject"];

/** Every attack at both levels; items without both scores count as missing. */
export const analyseModel = (
  items: readonly ItemRow[],
  target: ReadonlyMap<string, ScoreRow>,
  reference: ReadonlyMap<string, ScoreRow>,
  resamples: number,
  seed: number,
): ModelResult => {
  const cell = (level: Level, attack: Attack): AttackCell => {
    const atLevel = items.filter((item) => item.level === level);
    const rows = atLevel.flatMap((item) => {
      const t = target.get(item.id);
      const r = reference.get(item.id);
      if (!t || !r) return [];
      const score = attackScore(attack, tokenScores(t), tokenScores(r));
      return score === null
        ? []
        : [{ subject: item.subject, member: item.member, score }];
    });
    const result = evaluateAttack(rows, resamples, mulberry32(seed));
    return { ...result, missing: atLevel.length - rows.length };
  };
  const byLevel = (level: Level) =>
    Object.fromEntries(ATTACKS.map((attack) => [attack, cell(level, attack)])) as Record<
      Attack,
      AttackCell
    >;
  return { record: byLevel("record"), subject: byLevel("subject") };
};

export type ProbeRow = Readonly<{
  id: string;
  member: boolean;
  numbers: readonly number[];
}>;

export type ProbeResult = MatchComparison & Readonly<{ unanswered: number }>;

/** Exact-match rates of the probe answers, members against non-members. */
export const analyseProbes = (
  probes: readonly ProbeRow[],
  answers: ReadonlyMap<string, string>,
  permutations: number,
  seed: number,
): ProbeResult => {
  const rows = probes.flatMap((probe) => {
    const answer = answers.get(probe.id);
    return answer === undefined
      ? []
      : [{ member: probe.member, match: statesValue(answer, probe.numbers) }];
  });
  return {
    ...compareMatches(rows, permutations, mulberry32(seed)),
    unanswered: probes.length - rows.length,
  };
};

/** Pearson correlation; null with fewer than two pairs or no spread. */
export const pearson = (a: readonly number[], b: readonly number[]): number | null => {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i += 1) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return saa === 0 || sbb === 0 ? null : sab / Math.sqrt(saa * sbb);
};

const f3 = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : value.toFixed(3);
const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `${(100 * value).toFixed(1)}%`;

export const ATTACK_LABELS: Readonly<Record<Attack, string>> = {
  loss: "Loss",
  reference: "Reference (target minus reference)",
  minK20: "Min-K% (K = 20)",
  zlib: "zlib ratio",
  referenceDigits: "Reference, digit tokens only",
};

/** One Markdown table per model: attacks by level, AUROC with CI and TPR at 1% FPR. */
export const attackTable = (result: ModelResult): string => {
  const header =
    "| Attack | Level | Members / non-members | AUROC (95% CI) | TPR at 1% FPR (95% CI) |\n| --- | --- | --- | --- | --- |";
  const rows = LEVELS.flatMap((level) =>
    ATTACKS.map((attack) => {
      const c = result[level][attack];
      const tpr = c.tprAt1
        ? `${pct(c.tprAt1.value)} (${pct(c.tprAt1.ci95.low)} to ${pct(c.tprAt1.ci95.high)})`
        : "n/a";
      return `| ${ATTACK_LABELS[attack]} | ${level} | ${c.members} / ${c.nonMembers} | ${f3(c.auroc.value)} (${f3(c.auroc.ci95.low)} to ${f3(c.auroc.ci95.high)}) | ${tpr} |`;
    }),
  );
  return [header, ...rows].join("\n");
};

/** One row per probed model: match rates, difference and permutation p. */
export const probeTable = (
  rows: ReadonlyArray<readonly [string, ProbeResult]>,
): string => {
  const header =
    "| Model | Members: exact match (95% CI) | Non-members: exact match (95% CI) | Difference | Permutation p |\n| --- | --- | --- | --- | --- |";
  const rate = (r: ProbeResult["member"]) =>
    r
      ? `${r.k}/${r.n} ${pct(r.value)} (${pct(r.ci95.low)} to ${pct(r.ci95.high)})`
      : "n/a";
  const body = rows.map(
    ([name, r]) =>
      `| ${name} | ${rate(r.member)} | ${rate(r.nonMember)} | ${r.difference === null ? "n/a" : `${(100 * r.difference).toFixed(1)} points`} | ${r.permutationP === null ? "n/a" : r.permutationP.toFixed(3)} |`,
  );
  return [header, ...body].join("\n");
};
