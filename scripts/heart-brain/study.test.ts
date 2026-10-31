import { describe, expect, test } from "bun:test";

import { person } from "../../packages/query-tools/event-rates/fixtures.test-helpers";
import { renderReport, buildSummary } from "./report";
import { runStudy } from "./study";

/** 400 men born 1940-1942; every fourth gets AF in 2005, and AF people have strokes. */
const people = Array.from({ length: 400 }, (_, index) => {
  const birth = `${1940 + (index % 3)}-01-01`;
  const hasAf = index % 4 === 0;
  const stroke =
    hasAf && index % 8 === 0 ? "2008-01-01" : index % 50 === 1 ? "2015-01-01" : undefined;
  return person(`p${index}`, {
    birth,
    onset: {
      ...(hasAf ? { af: "2005-01-01" } : {}),
      ...(stroke === undefined ? {} : { stroke }),
      ...(index % 10 === 3 ? { sleepApnea: "2000-01-01" } : {}),
    },
    ...(hasAf ? { anticoagulant: "2005-03-01" } : {}),
  });
});

const options = { seed: 250, historyYears: 0, controlsPerExposed: 2, permutations: 5 };

describe("runStudy", () => {
  const study = runStudy(people, options);

  test("counts people and topics", () => {
    expect(study.people).toBe(400);
    expect(study.counts.af).toBe(100);
    expect(study.counts.stroke).toBe(50 + 8);
    expect(study.counts.sleepApnea).toBe(40);
    expect(study.order).toEqual({ both: 50, strokeFirst: 0, sameDay: 0, afFirst: 50 });
    expect(study.orderInWindow).toEqual(study.order);
  });

  test("finds the planted AF to stroke excess in this toy cohort", () => {
    const afStroke = study.rules.find((rule) => rule.id === "af-stroke");
    expect(afStroke?.recovered).toBe("raised");
    expect(afStroke?.agreement).toBe("recovered");
    expect(study.rules.at(-1)?.id).toBe("anticoagulant-stroke");
  });

  test("the same seed gives the same study", () => {
    expect(runStudy(people, options)).toEqual(study);
  });

  test("the report carries the run, the tables and the limits", () => {
    const summary = buildSummary(
      options,
      [
        {
          batch: "001",
          seed: 1001,
          clinicianSeed: 2001,
          syntheaVersion: "v4.0.0",
          jarSha256: "abc",
          endDate: "2026-01-01",
          bundles: 400,
          people: 400,
          skipped: 0,
          seconds: 1,
        },
      ],
      {
        cerebrovascular: { "230690007|Cerebrovascular accident (disorder)": 58 },
        anticoagulants: {},
      },
      study,
      "2026-10-30T00:00:00.000Z",
    );
    const report = renderReport(summary);
    expect(report).toContain(
      "| 001 | 1001 | 2001 | v4.0.0 | 2026-01-01 | 400 | 400 | 1 |",
    );
    expect(report).toContain("Synthea encodes rules, not medicine");
    expect(report).toContain(
      "`230690007|Cerebrovascular accident (disorder)` (58 records)",
    );
    expect(report).toContain("Oral anticoagulant codes in the data: none.");
    expect(report).toContain("| All | 50 | 0 | 0 | 50 |");
    expect(report).toContain("Outcomes are counted over the whole exported record.");
    expect(report).not.toContain("—");
  });
});
