import { describe, expect, test } from "bun:test";

import {
  cellsOf,
  confusableCells,
  traceStated,
} from "../../../infrastructure/wearable-cell";
import { FIXED_ORDER } from "../../synthetic-wearables/w1-items";

import { ARMS, generateStimuli, persona, TRIAL_COUNTS } from "./stimuli";
import { runStimuli } from "./stimuli-run";
import { stimulusPage } from "./stimulus-page";

const set = generateStimuli();
const { cells } = persona(set.seed, set.attempt);
const detection = set.trials.filter((trial) => trial.kind === "detection");

const near = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= 86_400_000;

/** Every source's reading that night, and the claimed source's on the nights next to it. */
const checkedFor = (trial: (typeof set.trials)[number]) =>
  cells.filter(
    (cell) =>
      cell.measure === trial.measure &&
      (cell.day === trial.claimed.day ||
        (cell.source === trial.claimed.source && near(cell.day!, trial.claimed.day))),
  );
const calibration = set.trials.filter((trial) => trial.kind === "calibration");

describe("persona", () => {
  test("a stated number shows once among the readings it is checked against", () => {
    for (const trial of set.trials) {
      const pairs = confusableCells(checkedFor(trial)).filter((pair) =>
        pair.some((cell) => cell.key === trial.actual.key),
      );
      expect(pairs).toEqual([]);
    }
  });

  test("seeded: the same seed gives the same nights", () => {
    expect(persona(set.seed, 1)).toEqual(persona(set.seed, 1));
    expect(persona(set.seed + 1, 1)).not.toEqual(persona(set.seed, 1));
  });
});

describe("generateStimuli", () => {
  test("16 detection trials (8, 4, 4) and 6 calibration trials", () => {
    expect(detection).toHaveLength(16);
    for (const [truth, count] of Object.entries(TRIAL_COUNTS)) {
      expect(detection.filter((trial) => trial.truth === truth)).toHaveLength(count);
    }
    expect(calibration).toHaveLength(6);
  });

  test("balanced over the two measures within each kind of detection trial", () => {
    for (const truth of ["correct", "wrong_source", "wrong_day"] as const) {
      const of = detection.filter((trial) => trial.truth === truth);
      const rhr = of.filter((trial) => trial.measure === "resting-heart-rate").length;
      expect(rhr).toBe(of.length / 2);
    }
  });

  test("the stated number is the actual reading, and the truth says how it relates to the claim", () => {
    for (const trial of set.trials) {
      const stated = trial.answer.match(/was (.+)\.$/)?.[1] ?? "";
      const trace = traceStated(stated, trial.measure, checkedFor(trial));
      expect(trace.kind === "one" && trace.cell.key).toBe(trial.actual.key);
      const sameSource = trial.actual.source === trial.claimed.source;
      const sameDay = trial.actual.day === trial.claimed.day;
      expect(
        trial.truth === "correct"
          ? sameSource && sameDay
          : trial.truth === "wrong_source"
            ? !sameSource && sameDay
            : sameSource && !sameDay,
      ).toBe(true);
    }
  });

  test("the chip claims the source the fixed order shows that night", () => {
    for (const trial of set.trials) {
      const that = cells.filter(
        (cell) => cell.measure === trial.measure && cell.day === trial.claimed.day,
      );
      const shown = FIXED_ORDER.find((source) =>
        that.some((cell) => cell.source === source),
      );
      expect(shown).toBe(trial.claimed.source);
    }
  });

  test("calibration: three validated and three with no evidence, all correct", () => {
    expect(calibration.every((trial) => trial.truth === "correct")).toBe(true);
    expect(calibration.filter((trial) => trial.evidence === "validated")).toHaveLength(3);
    expect(calibration.filter((trial) => trial.evidence === "none")).toHaveLength(3);
  });

  test("the answer is the same in every arm; only the display differs", () => {
    for (const trial of set.trials) {
      expect(trial.display.D0).toEqual({
        chip: null,
        rule: null,
        note: null,
        level: null,
      });
      expect(trial.display.D1.chip).toStartWith("From ");
      expect(trial.display.D1.note).toBeNull();
      expect(trial.display.D2.chip).toBe(trial.display.D1.chip);
      expect(trial.display.D2.note).not.toBeNull();
    }
  });

  test("the panel lists every reading", () => {
    expect(set.panel).toHaveLength(cells.length);
    expect(cellsOf([])).toEqual([]);
  });
});

describe("stimulusPage", () => {
  test("a static page per arm: no script, no request, the persona marked synthetic", () => {
    for (const arm of ARMS) {
      const page = stimulusPage(set, arm);
      expect(page).not.toContain("<script");
      expect(page).not.toMatch(/https?:\/\//);
      expect(page).toContain("synthetic person");
    }
    expect(stimulusPage(set, "D0")).not.toContain('class="chip"');
    expect(stimulusPage(set, "D1")).toContain('class="chip"');
    expect(stimulusPage(set, "D1")).not.toContain('class="accuracy"');
    expect(stimulusPage(set, "D2")).toContain('class="accuracy"');
  });
});

describe("runStimuli", () => {
  test("writes the set and three pages", async () => {
    const written = new Map<string, string>();
    const code = await runStimuli(
      ["--out", "out"],
      { stdout: { write: () => {} }, stderr: { write: () => {} } },
      async (path, text) => {
        written.set(path, text);
      },
    );
    expect(code).toBe(0);
    expect([...written.keys()].toSorted()).toEqual([
      "out/D0.html",
      "out/D1.html",
      "out/D2.html",
      "out/stimuli.json",
    ]);
  });
});
