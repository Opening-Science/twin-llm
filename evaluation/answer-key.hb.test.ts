/**
 * Checks for the hb set (#293): `answer-key.hb.v1.json` was built from
 * `questions.hb.v1.json` by `cohort_event_rates` over `synthea-v4-1m-af`, the
 * cohort the committed manifest pins, and the key's verdicts agree with the
 * planted rule each verdict item is tagged with. Offline: the key is read,
 * never rebuilt (that needs the eval database, `bun run eval:answer-key:hb`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  HB_MANIFEST_PATH,
  questionsSha256,
} from "../scripts/evaluation/build-answer-key";
import {
  answerKeySchema,
  type KeyEntry,
  questionSetSchema,
} from "../scripts/evaluation/question-set";
import { isVerdict, plantedVerdictOf } from "../scripts/evaluation/score/verdict-match";
import { BANNED_TERMS } from "../scripts/lint-claims";

const readText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const rawQuestions = JSON.parse(readText("./questions.hb.v1.json")) as unknown;
const keyText = readText("./answer-key.hb.v1.json");
const set = questionSetSchema.parse(rawQuestions);
const key = answerKeySchema.parse(JSON.parse(keyText) as unknown);
const manifest = JSON.parse(readText(`../${HB_MANIFEST_PATH}`)) as {
  cohortId: string;
  people: number;
  contentSha256: string;
};
const entriesOf = (id: string): readonly KeyEntry[] => key.entries[id] ?? [];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("hb answer key", () => {
  test("is the key of these questions, on the cohort the manifest pins", () => {
    expect(key.questions_sha256).toBe(questionsSha256(rawQuestions));
    expect(set.cohort_id).toBe("synthea-v4-1m-af");
    expect(key.cohort.id).toBe(manifest.cohortId);
    expect(key.cohort.content_sha256).toBe(manifest.contentSha256);
    expect(key.cohort.subjects).toBe(manifest.people);
  });

  test("keys every value of every item, from cohort_event_rates", () => {
    for (const item of set.items) {
      const names = (item.expect.values ?? []).map((value) => value.name);
      expect(entriesOf(item.id).map((entry) => entry.name)).toEqual(names);
      for (const entry of entriesOf(item.id)) {
        expect(entry.tool).toBe("cohort_event_rates");
      }
    }
  });

  test("every keyed verdict is the planted one", () => {
    const rows = set.items.flatMap((item) => {
      const planted = plantedVerdictOf(item.tags ?? []);
      const keyed = entriesOf(item.id).find((entry) => entry.path === "verdict")?.value;
      return planted === null
        ? []
        : [[item.id, isVerdict(keyed) ? keyed : null, planted]];
    });
    expect(rows.length).toBe(11);
    for (const [, keyed, planted] of rows) expect(keyed).toBe(planted);
  });

  test("refusals are the codes the rule names", () => {
    const codes = set.items.flatMap((item) =>
      entriesOf(item.id)
        .filter((entry) => entry.path === "code")
        .map((entry) => [item.id, entry.value]),
    );
    expect(codes).toEqual([
      ["Q-S7-81", "DESIGN_NOT_SUPPORTED"],
      ["Q-S7-82", "DESIGN_NOT_SUPPORTED"],
      ["Q-S7-83", "COHORT_NOT_SUPPORTED"],
    ]);
  });

  test("no question or key holds a subject_ref; the set's own copy no banned claim", () => {
    expect(UUID.test(JSON.stringify(rawQuestions))).toBe(false);
    expect(UUID.test(keyText)).toBe(false);
    // The decline questions are a person's own words ("was diagnosed") and stay as asked.
    const texts = set.items.flatMap((item) => [item.human, ...item.expect.must_not]);
    const hits = texts.flatMap((text) =>
      BANNED_TERMS.filter((term) => new RegExp(term.source, "i").test(text)).map(
        (term) => `${term.id}: ${text}`,
      ),
    );
    expect(hits).toEqual([]);
  });
});
