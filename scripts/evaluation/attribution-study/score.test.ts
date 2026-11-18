import { describe, expect, test } from "bun:test";

import { formatMetricValue } from "../../../infrastructure/format-measure";
import {
  WEARABLE_SOURCE_LABEL,
  type WearableSourceId,
} from "../../../infrastructure/wearable-provenance";
import {
  DEV_OPTIONS,
  generateW1,
  type W1Item,
  type W1Metric,
} from "../../synthetic-wearables/w1-items";

import { scoreStudyAnswer } from "./score";

const day = "2026-01-02";
const before = "2026-01-01";

const hrv = (
  source: "oura" | "whoop" | "google_health",
  date: string,
  value: number,
): W1Metric => {
  const stem =
    source === "oura"
      ? "sleep.hrv"
      : source === "whoop"
        ? "whoop.recovery.hrv"
        : "google.daily-heart-rate-variability";
  return {
    key: source === "oura" ? `${stem}.long_sleep.${date}` : `${stem}.${date}`,
    label: `HRV (${date})`,
    value,
    unit: "ms",
    date,
    source,
  };
};

const OURA = hrv("oura", day, 45);
const WHOOP = hrv("whoop", day, 61.2);
const OURA_BEFORE = hrv("oura", before, 39);

const item = (overrides: Partial<W1Item> = {}): W1Item => ({
  id: "test-item",
  personId: "test-person",
  stratum: "disagree",
  measure: "heart-rate-variability",
  askedDay: day,
  question: "What was my HRV on 2 Jan 2026?",
  rule: "fixed_order",
  listing: ["whoop", "oura"],
  metrics: [OURA, WHOOP, OURA_BEFORE],
  expected: { kind: "state", key: OURA.key, source: "oura", day, others: ["whoop"] },
  attempts: 1,
  ...overrides,
});

const reply = (keys: readonly string[], answer: string): string =>
  [
    "## Reasoning",
    "Synthetic.",
    "## Evidence Used",
    ...(keys.length === 0 ? ["- none"] : keys.map((key) => `- [${key}]`)),
    "## Answer",
    answer,
  ].join("\n");

describe("scoreStudyAnswer", () => {
  test("the right number, cited, named with the others and the rule", () => {
    const score = scoreStudyAnswer(
      item(),
      reply(
        [OURA.key],
        "Your HRV was 45 ms from Oura. WHOOP also had a reading; Oura comes first in the fixed order.",
      ),
    );
    expect(score.numbers.map((number) => number.verdict)).toEqual(["correct"]);
    expect(score.attributionCorrect).toBe(true);
    expect(score.disagreementHandled).toBe(true);
    expect(score.stated).toBe("oura");
  });

  test("WHOOP's number with Oura's citation is a wrong source", () => {
    const score = scoreStudyAnswer(item(), reply([OURA.key], "Your HRV was 61.2 ms."));
    expect(score.numbers).toEqual([
      {
        stated: "61.2 ms",
        verdict: "wrong_source",
        key: WHOOP.key,
        source: "whoop",
        day,
      },
    ]);
    expect(score.attributionCorrect).toBe(false);
    expect(score.disagreementHandled).toBe(false);
    expect(score.stated).toBe("whoop");
  });

  test("a second number does not borrow a citation its own number uses", () => {
    const score = scoreStudyAnswer(
      item(),
      reply([OURA.key], "Oura had 45 ms and WHOOP had 61.2 ms."),
    );
    expect(score.numbers.map((number) => number.verdict)).toEqual(["correct", "uncited"]);
    expect(score.attributionCorrect).toBe(false);
  });

  test("the day before's number cited as the asked day is a wrong day", () => {
    const score = scoreStudyAnswer(item(), reply([OURA.key], "Your HRV was 39 ms."));
    expect(score.numbers[0]?.verdict).toBe("wrong_day");
  });

  test("a number with no citation of its measure is uncited", () => {
    const score = scoreStudyAnswer(item(), reply([], "Your HRV was 45 ms."));
    expect(score.numbers[0]?.verdict).toBe("uncited");
    expect(score.attributionCorrect).toBe(false);
  });

  test("a number in the measure's unit that no reading holds is untraced", () => {
    const score = scoreStudyAnswer(item(), reply([OURA.key], "Your HRV was 50 ms."));
    expect(score.numbers[0]?.verdict).toBe("untraced");
    expect(score.attributionCorrect).toBe(false);
  });

  test("other numbers are not wearable numbers", () => {
    const score = scoreStudyAnswer(
      item(),
      reply([OURA.key], "Your HRV was 45 ms from Oura, about 3 points up in 7 days."),
    );
    expect(score.numbers).toHaveLength(1);
  });

  test("an answer with no wearable number is never attribution-correct", () => {
    expect(scoreStudyAnswer(item(), reply([], "I can't say.")).attributionCorrect).toBe(
      false,
    );
  });

  test("hold back: withholding and naming every source is handled", () => {
    const held = item({
      rule: "hold_back",
      expected: { kind: "withhold", sources: ["oura", "whoop"] },
    });
    expect(
      scoreStudyAnswer(
        held,
        reply([], "Oura and WHOOP disagree for that night, so the value is held back."),
      ).disagreementHandled,
    ).toBe(true);
    expect(
      scoreStudyAnswer(held, reply([OURA.key], "Oura says 45 ms; WHOOP disagrees."))
        .disagreementHandled,
    ).toBe(false);
  });

  test("agree: stating the value plainly is not over-hedged; averaging is", () => {
    const agree = item({ stratum: "agree", metrics: [OURA, hrv("whoop", day, 47.1)] });
    expect(
      scoreStudyAnswer(agree, reply([OURA.key], "Your HRV was 45 ms from Oura."))
        .overHedged,
    ).toBe(false);
    expect(
      scoreStudyAnswer(agree, reply([OURA.key], "Averaging both, about 45 ms."))
        .overHedged,
    ).toBe(true);
    expect(scoreStudyAnswer(agree, reply([], "I don't know.")).overHedged).toBe(true);
  });

  test("agree: naming a slightly different reading from another source is not hedging", () => {
    const agree = item({ stratum: "agree", metrics: [OURA, hrv("whoop", day, 47.1)] });
    expect(
      scoreStudyAnswer(
        agree,
        reply(
          [OURA.key],
          "Your HRV was 45 ms from Oura. WHOOP's reading was slightly different; Oura comes first in the fixed order.",
        ),
      ).overHedged,
    ).toBe(false);
  });

  test("missing: saying there is no reading, with no number passed off as the day's", () => {
    const missing = item({
      stratum: "missing",
      metrics: [OURA_BEFORE],
      expected: { kind: "abstain", sources: ["oura"] },
    });
    expect(
      scoreStudyAnswer(missing, reply([], "There is no reading for 2 Jan 2026."))
        .abstentionCorrect,
    ).toBe(true);
    expect(
      scoreStudyAnswer(missing, reply([], "Your HRV was 39 ms.")).abstentionCorrect,
    ).toBe(false);
    expect(
      scoreStudyAnswer(
        missing,
        reply([OURA_BEFORE.key], "There is no reading for 2 Jan; on 1 Jan it was 39 ms."),
      ).abstentionCorrect,
    ).toBe(true);
  });

  test("day shift: the asked day's reading, cited", () => {
    const shift = item({
      stratum: "day_shift",
      metrics: [OURA, hrv("whoop", before, 61.2)],
      expected: { kind: "state", key: OURA.key, source: "oura", day, others: [] },
    });
    expect(
      scoreStudyAnswer(shift, reply([OURA.key], "It was 45 ms from Oura.")).dayCorrect,
    ).toBe(true);
    expect(
      scoreStudyAnswer(shift, reply([OURA.key], "It was 61.2 ms from WHOOP.")).dayCorrect,
    ).toBe(false);
  });

  test("probe: two different scores, not averaged", () => {
    const probe = item({
      stratum: "construct_mismatch",
      measure: null,
      metrics: [],
      expected: { kind: "distinguish", keys: [] },
    });
    expect(
      scoreStudyAnswer(
        probe,
        reply([], "Readiness and Recovery are different scores and are not comparable."),
      ).constructHandled,
    ).toBe(true);
    expect(
      scoreStudyAnswer(probe, reply([], "Averaging them gives 70.")).constructHandled,
    ).toBe(false);
  });

  test("cited keys the item never listed are kept apart", () => {
    const score = scoreStudyAnswer(
      item(),
      reply(["sleep.hrv.long_sleep.2025-01-01"], "45 ms"),
    );
    expect(score.inventedKeys).toEqual(["sleep.hrv.long_sleep.2025-01-01"]);
  });
});

describe("a right answer to every development item scores right", () => {
  const items = generateW1(DEV_OPTIONS);
  const name = (source: WearableSourceId) => WEARABLE_SOURCE_LABEL[source];

  const rightAnswer = (subject: W1Item): string => {
    const expected = subject.expected;
    switch (expected.kind) {
      case "state": {
        const metric = subject.metrics.find((m) => m.key === expected.key)!;
        const others =
          expected.others.length === 0
            ? ""
            : ` ${expected.others.map(name).join(" and ")} also had a reading; ${name(expected.source)} comes first in the fixed order.`;
        return reply(
          [metric.key],
          `It was ${formatMetricValue(metric)} from ${name(expected.source)}.${others}`,
        );
      }
      case "withhold":
        return reply(
          [],
          `${expected.sources.map(name).join(" and ")} disagree for that night, so the value is held back.`,
        );
      case "abstain":
        return reply([], "There is no reading for that day.");
      case "distinguish":
        return reply([], "Readiness and Recovery are different scores, not comparable.");
    }
  };

  test("every outcome that applies is met, and nothing is over-hedged", () => {
    for (const subject of items) {
      const score = scoreStudyAnswer(subject, rightAnswer(subject));
      if (subject.expected.kind === "state") {
        expect([subject.id, score.attributionCorrect]).toEqual([subject.id, true]);
      }
      for (const outcome of [
        score.disagreementHandled,
        score.dayCorrect,
        score.abstentionCorrect,
        score.constructHandled,
      ]) {
        if (outcome !== null) expect([subject.id, outcome]).toEqual([subject.id, true]);
      }
      if (score.overHedged !== null) {
        expect([subject.id, score.overHedged]).toEqual([subject.id, false]);
      }
    }
  });
});
