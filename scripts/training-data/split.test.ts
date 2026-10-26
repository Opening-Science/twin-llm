import { describe, expect, test } from "bun:test";

import { runSplitConversations, parseSplitArgs } from "./split-conversations";
import { holdoutReasons, planSplit, type SplitMeta } from "./split";
import { conversationStats, messageChars, percentile } from "./stats";

const meta = (
  family: string,
  group: string,
  loinc: string | null,
  ref: string | null,
): SplitMeta => ({
  family,
  template_group: group,
  measure_loinc: loinc,
  subject_ref: ref,
});

/** Four families, several groups and codes, ten subjects each. */
const METAS: readonly SplitMeta[] = Array.from(
  { length: 10 },
  (_, n) => `s-${n}`,
).flatMap((ref) => [
  meta("latest_value", "latest.formal", "8867-4", ref),
  meta("latest_value", "latest.casual", "4548-4", ref),
  meta("absent_code", "latest.terse", "2276-4", ref),
  meta("absent_code", "latest.non_native", "2143-6", ref),
  meta("trend", "trendClinical.formal", "4548-4", ref),
  meta("trend", "trendClinical.casual", "29463-7", ref),
  meta("trend", "trendWearable.terse", "8867-4", ref),
  meta("no_code", "noCode.formal", null, ref),
  meta("no_code", "noCode.terse", null, ref),
  meta("other_person", "otherPerson.formal", null, null),
]);

const OPTIONS = { seed: 3, templateShare: 0.3, codeShare: 0.3, subjectShare: 0.2 };

describe("planSplit", () => {
  test("holds out whole groups and codes, deterministically", () => {
    const plan = planSplit(METAS, OPTIONS);
    expect(plan).toEqual(planSplit(METAS, OPTIONS));
    expect(plan.templateGroups.length).toBe(3);
    expect(plan.loinc.length).toBe(2);
    expect(planSplit(METAS, { ...OPTIONS, seed: 4 })).not.toEqual(plan);
  });

  test("never empties a family or a slot in training", () => {
    for (const seed of Array.from({ length: 40 }, (_, n) => n)) {
      const options = { ...OPTIONS, seed, templateShare: 0.9, codeShare: 0.9 };
      const plan = planSplit(METAS, options);
      const train = METAS.filter(
        (item) =>
          !plan.templateGroups.includes(item.template_group) &&
          !(item.measure_loinc !== null && plan.loinc.includes(item.measure_loinc)),
      );
      expect(new Set(train.map((item) => item.family))).toEqual(
        new Set(METAS.map((item) => item.family)),
      );
      expect(new Set(train.map((item) => item.template_group.split(".")[0]))).toEqual(
        new Set(["latest", "trendClinical", "trendWearable", "noCode", "otherPerson"]),
      );
    }
  });

  test("a held-out code takes every conversation about it, in any family", () => {
    const plan = { templateGroups: [], loinc: ["4548-4"] };
    const options = { ...OPTIONS, subjectShare: 0 };
    const held = METAS.filter((item) => holdoutReasons(item, plan, options).length > 0);
    expect(new Set(held.map((item) => `${item.family}:${item.measure_loinc}`))).toEqual(
      new Set(["latest_value:4548-4", "trend:4548-4"]),
    );
    expect(holdoutReasons(METAS[0] as SplitMeta, plan, options)).toEqual([]);
  });

  test("reasons add up: template, code and subject", () => {
    const plan = { templateGroups: ["latest.formal"], loinc: ["8867-4"] };
    const options = { ...OPTIONS, subjectShare: 0.999 };
    expect(holdoutReasons(METAS[0] as SplitMeta, plan, options)).toEqual([
      "template",
      "code",
      "subject",
    ]);
    expect(holdoutReasons(METAS[9] as SplitMeta, plan, options)).toEqual([]);
  });
});

describe("stats", () => {
  test("percentiles are nearest rank", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([], 50)).toBe(0);
  });

  test("counts families, templates and shares", () => {
    const rows = [
      { family: "latest_value", outcome: "answered", template_id: "latest.formal.1" },
      { family: "absent_code", outcome: "no_rows", template_id: "latest.formal.1" },
      {
        family: "unit_conversion",
        outcome: "converted",
        template_id: "unitConversion.terse.2",
      },
      { family: "trend", outcome: "MIXED_UNITS", template_id: "trendClinical.formal.1" },
    ].map((item, index) => ({
      meta: {
        ...item,
        template_group: item.template_id.split(".").slice(0, 2).join("."),
        style: item.template_id.split(".")[1] ?? "",
        typo: index === 0,
      },
      chars: (index + 1) * 100,
    }));
    const stats = conversationStats(rows, 40);
    expect(stats.by_family).toEqual({
      absent_code: 1,
      latest_value: 1,
      trend: 1,
      unit_conversion: 1,
    });
    expect(stats.by_template).toEqual({
      "latest.formal.1": 2,
      "trendClinical.formal.1": 1,
      "unitConversion.terse.2": 1,
    });
    expect([stats.typo_share, stats.no_data_share, stats.unit_share]).toEqual([
      0.25, 0.25, 0.5,
    ]);
    expect(stats.message_chars).toEqual({
      p50: 200,
      p90: 400,
      p95: 400,
      p99: 400,
      max: 400,
    });
    expect(stats.approx_tokens.messages.p50).toBe(50);
    expect(stats.approx_tokens.tools).toBe(10);
  });

  test("message length counts contents and tool calls", () => {
    expect(
      messageChars([
        { role: "user", content: "abcd" },
        { role: "assistant", content: null, tool_calls: [{ id: "x" }] },
      ]),
    ).toBe(4 + JSON.stringify([{ id: "x" }]).length);
  });
});

const record = (n: number) =>
  JSON.stringify({ messages: [{ role: "user", content: `q${n}` }] });

const fullMeta = (item: SplitMeta, n: number) => ({
  ...item,
  outcome: "answered",
  template_id: `${item.template_group}.1`,
  style: item.template_group.split(".")[1],
  typo: false,
  n,
});

describe("runSplitConversations", () => {
  const harness = (metaLines: readonly string[], records: readonly string[]) => {
    const files = new Map<string, string>([
      ["/tmp/c.jsonl", `${records.join("\n")}\n`],
      ["/tmp/c.meta.jsonl", `${metaLines.join("\n")}\n`],
      ["/tmp/c.manifest.json", JSON.stringify({ tools: [{ name: "x" }] })],
    ]);
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    };
    const deps = {
      readText: async (path: string) => files.get(path) ?? null,
      writeText: async (path: string, text: string) => {
        files.set(path, text);
      },
    };
    return { files, out, err, io, deps };
  };

  test("writes train and validation files that partition the input, and a manifest", async () => {
    const metas = METAS.map((item, n) => JSON.stringify(fullMeta(item, n)));
    const records = METAS.map((_, n) => record(n));
    const h = harness(metas, records);
    const code = await runSplitConversations(
      [
        "--in",
        "/tmp/c.jsonl",
        "--seed",
        "3",
        "--template-share",
        "0.3",
        "--code-share",
        "0.3",
      ],
      h.io,
      h.deps,
    );
    expect(code).toBe(0);
    const lines = (path: string) => (h.files.get(path) ?? "").split("\n").filter(Boolean);
    const train = lines("/tmp/c.train.jsonl");
    const val = lines("/tmp/c.val.jsonl");
    expect([...train, ...val].sort()).toEqual([...records].sort());
    expect(lines("/tmp/c.train.meta.jsonl").length).toBe(train.length);
    expect(lines("/tmp/c.val.meta.jsonl").length).toBe(val.length);
    const manifest = JSON.parse(h.files.get("/tmp/c.split.json") ?? "{}") as {
      held_out: { template_groups: string[]; loinc: string[] };
      train: number;
      val: number;
      stats: { train: { conversations: number }; val: { conversations: number } };
    };
    const plan = planSplit(METAS, { ...OPTIONS, subjectShare: 0.02 });
    expect(manifest.held_out).toEqual({
      template_groups: [...plan.templateGroups],
      loinc: [...plan.loinc],
    });
    expect([manifest.train, manifest.val]).toEqual([train.length, val.length]);
    expect(manifest.stats.val.conversations).toBe(val.length);
    // Every validation meta line says why it is there.
    const reasons = lines("/tmp/c.val.meta.jsonl").map(
      (line) => (JSON.parse(line) as { holdout_reasons: string[] }).holdout_reasons,
    );
    expect(reasons.every((list) => list.length > 0)).toBe(true);
    // No training line uses a held-out group or code.
    const trainMetas = lines("/tmp/c.train.meta.jsonl").map(
      (line) => JSON.parse(line) as SplitMeta,
    );
    expect(
      trainMetas.filter(
        (item) =>
          manifest.held_out.template_groups.includes(item.template_group) ||
          manifest.held_out.loinc.includes(item.measure_loinc ?? ""),
      ),
    ).toEqual([]);
  });

  test("refuses meta lines from the older generator", async () => {
    const h = harness(
      [JSON.stringify({ family: "trend", outcome: "answered" })],
      [record(0)],
    );
    expect(await runSplitConversations(["--in", "/tmp/c.jsonl"], h.io, h.deps)).toBe(1);
    expect(h.err).toEqual([
      "The records and meta files do not match line for line, or the meta lines are from an older generator (no template_id). Rebuild with training:conversations.\n",
    ]);
  });

  test("checks its flags", () => {
    expect(parseSplitArgs([])).toBe(
      "Usage: bun run training:split -- --in <conversations>.jsonl",
    );
    expect(parseSplitArgs(["--in", "x.jsonl", "--code-share", "1"])).toBe(
      "--code-share must be a number from 0 up to (not including) 1.",
    );
    expect(parseSplitArgs(["--in", "x.jsonl"])).toEqual({
      input: "x.jsonl",
      seed: 1,
      templateShare: 0.1,
      codeShare: 0.1,
      subjectShare: 0.02,
    });
  });
});
