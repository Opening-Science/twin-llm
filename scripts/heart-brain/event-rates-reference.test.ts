import { describe, expect, test } from "bun:test";

import { cohortSetupOf } from "../../packages/query-tools/event-rates/cohort-rates";

import {
  REFERENCE_RELATIONS,
  referenceRows,
  warehouseRowsOf,
} from "./event-rates-reference";
import { type PersonFacts } from "./person-facts";
import { toPerson } from "./to-person";

const facts = (
  id: string,
  birth: string,
  death: string | null,
  onsets: PersonFacts["onsets"],
): PersonFacts => ({
  id,
  batch: "001",
  sex: "F",
  birth,
  death,
  onsets,
  anticoagulantStart: null,
});

const PEOPLE = [
  facts("p", "1950-03-10", "2019-11-20", { af: "2017-01-01", stroke: "2018-01-01" }),
  facts("q", "1950-09-30", null, { af: "2018-01-01", dementia: "2020-05-05" }),
];

describe("warehouseRowsOf", () => {
  test("keeps years, sex and first onsets, as the warehouse stores them", () => {
    expect(warehouseRowsOf(PEOPLE)).toEqual({
      subjects: [
        { subjectRef: "p", sex: "female", birthYear: 1950, deathYear: 2019 },
        { subjectRef: "q", sex: "female", birthYear: 1950, deathYear: null },
      ],
      conditions: [
        {
          subjectRef: "p",
          code: "49436004",
          onsetAt: new Date("2017-01-01T00:00:00.000Z"),
        },
        {
          subjectRef: "p",
          code: "230690007",
          onsetAt: new Date("2018-01-01T00:00:00.000Z"),
        },
        {
          subjectRef: "q",
          code: "49436004",
          onsetAt: new Date("2018-01-01T00:00:00.000Z"),
        },
        {
          subjectRef: "q",
          code: "26929004",
          onsetAt: new Date("2020-05-05T00:00:00.000Z"),
        },
      ],
    });
  });
});

describe("referenceRows", () => {
  test("one row per relation, exact and warehouse people counted alike", () => {
    const setup = cohortSetupOf("synthea-v4-1m-af");
    if (setup === null) throw new Error("no setup");
    const exact = PEOPLE.map((person) =>
      toPerson(person, setup.endDay, setup.historyYears),
    );
    const rows = referenceRows(exact, PEOPLE, setup);
    expect(rows.map((row) => row.id)).toEqual(REFERENCE_RELATIONS.map((r) => r.id));
    const stroke = rows[0];
    // p: before 2016-01-01 to 2017-01-01 (366 days), after to its stroke (365 days);
    // q: before 2016-01-01 to 2018-01-01 (731 days), after to 2026-01-01 (2922 days).
    expect([
      stroke?.exact.before_onset.events,
      stroke?.exact.before_onset.person_years,
      stroke?.exact.after_onset.events,
      stroke?.exact.after_onset.person_years,
    ]).toEqual([0, 3, 1, 9]);
    expect(stroke?.warehouse.after_onset.events).toBe(1);
  });
});
