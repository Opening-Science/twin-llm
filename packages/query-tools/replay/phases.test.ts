import { describe, expect, test } from "bun:test";

import { personalBaseline } from "./baseline";
import {
  DEMO_DST_DAY,
  DEMO_PERSON_A,
  DEMO_PERSON_B,
  DEMO_REFERENCE_DAY,
  DEMO_TIME_ZONE,
  demoReplayDay,
  demoReplayDays,
} from "./demo-days";
import { replayNarrationSchema } from "./items";
import { localClock, localDayBounds, localInstant } from "./local-time";
import {
  GLUCOSE_PHASES,
  HEART_PHASES,
  rulesOf,
  type StoryPhase,
  storyPhases,
} from "./phases";
import { type ReplayDay, replayDaySchema } from "./replay-day";
import { STATUS_WORDS } from "./status-rules";

const day = (subject: string, date: string): ReplayDay => {
  const found = demoReplayDay(subject, date);
  if (found === null) throw new Error(`no demo day ${subject} ${date}`);
  return found;
};

const phasesOf = (one: ReplayDay): readonly StoryPhase[] =>
  storyPhases(one, {
    restingBaseline: personalBaseline(
      demoReplayDays(one.subject_ref),
      { ...one },
      "resting_heart_rate",
    ),
  });

const REFERENCE = day(DEMO_PERSON_A, DEMO_REFERENCE_DAY);
const PHASES = phasesOf(REFERENCE);

const find = (stream: StoryPhase["stream"], phase: string): StoryPhase => {
  const found = PHASES.find((one) => one.stream === stream && one.phase === phase);
  if (found === undefined) throw new Error(`no ${stream} ${phase}`);
  return found;
};

const clock = (iso: string): string => localClock(new Date(iso), DEMO_TIME_ZONE).time;

describe("the reference day shows all sixteen phases", () => {
  test("eight heart-rate phases", () => {
    expect(
      PHASES.filter((one) => one.stream === "heart_rate").map((one) => one.phase),
    ).toEqual([
      "sleep",
      "waking",
      "resting",
      "walking",
      "elevated_still",
      "running",
      "recovery",
      "winding_down",
    ]);
    expect(
      new Set(
        PHASES.filter((one) => one.stream === "heart_rate").map((one) => one.phase),
      ),
    ).toEqual(new Set(HEART_PHASES));
  });

  test("eight glucose phases, lunch with its walk", () => {
    const glucose = PHASES.filter((one) => one.stream === "glucose").map(
      (one) => one.phase,
    );
    expect(glucose).toEqual([
      "overnight_fasting",
      "dawn",
      "breakfast",
      "lunch_with_walking",
      "snack",
      "running",
      "dinner",
      "return_to_sleep",
    ]);
    expect(GLUCOSE_PHASES.filter((one) => !glucose.includes(one))).toEqual(["lunch"]);
  });

  test("glucose phases read the sensor series", () => {
    expect(
      PHASES.filter((one) => one.stream === "glucose").every(
        (one) => one.specimen === "sensor",
      ),
    ).toBe(true);
  });

  test("the windows sit where the evidence is", () => {
    expect([
      clock(find("heart_rate", "elevated_still").from),
      clock(find("heart_rate", "elevated_still").to),
    ]).toEqual(["15:00", "15:45"]);
    expect(clock(find("glucose", "dawn").from) < "06:30").toBe(true);
    expect(clock(find("glucose", "dawn").to)).toBe("06:30");
    expect(clock(find("glucose", "lunch_with_walking").to)).toBe("13:30");
  });

  test("the same call gives the same phases", () => {
    expect(phasesOf(day(DEMO_PERSON_A, DEMO_REFERENCE_DAY))).toEqual(PHASES);
  });
});

describe("every phase exposes its rule and evidence", () => {
  const ids = new Set([
    ...REFERENCE.readings.map((one) => one.id),
    ...REFERENCE.events.map((one) => one.id),
  ]);
  // Ids from other days are the baseline's nights, written day/id: each must
  // name a reading on that day of the person's own history.
  const historyIds = new Set(
    demoReplayDays(REFERENCE.subject_ref).flatMap((one) =>
      one.readings.map((reading) => `${one.day}/${reading.id}`),
    ),
  );

  test("a day/id that is not in the person's history is not evidence", () => {
    expect(historyIds.has("2026-10-20/night-resting-hr")).toBe(true);
    expect(historyIds.has("2026-09-01/night-resting-hr")).toBe(false);
    expect(historyIds.has("2026-10-20/no-such-reading")).toBe(false);
  });

  test("derived, with a rule, a status rule and evidence that exists", () => {
    for (const phase of PHASES) {
      expect(phase.provenance).toBe("derived");
      expect(phase.rule.text.length).toBeGreaterThan(0);
      expect(phase.status.rule.text.length).toBeGreaterThan(0);
      expect(phase.status.words).toBe(STATUS_WORDS[phase.status.status]);
      expect(phase.evidence.length).toBeGreaterThan(0);
      for (const id of [...phase.evidence, ...phase.status.evidence]) {
        expect(ids.has(id) || historyIds.has(id)).toBe(true);
      }
    }
  });

  test("a peak or a low is derived and points at its reading", () => {
    const run = find("heart_rate", "running");
    expect(run.extreme?.kind).toBe("highest");
    expect(run.extreme?.provenance).toBe("derived");
    expect(
      REFERENCE.readings.find((one) => one.id === run.extreme?.reading_id)?.value,
    ).toBe(run.extreme?.value);
    expect(find("heart_rate", "sleep").extreme?.kind).toBe("lowest");
  });

  test("the rules used are listed once each", () => {
    expect(
      rulesOf(PHASES)
        .map((rule) => rule.id)
        .sort(),
    ).toEqual([
      "glucose_meal_rise",
      "glucose_past_threshold",
      "heart_rate_activity_not_judged",
      "heart_rate_near_resting_baseline",
      "heart_rate_recovery_within_hour",
      "heart_rate_still_above",
    ]);
  });
});

describe("statuses", () => {
  test("a high heart rate on a run is not flagged for being high", () => {
    const run = find("heart_rate", "running");
    expect(run.extreme?.value).toBeGreaterThan(150);
    expect(run.status.status).toBe("usual");
    expect(run.status.rule.id).toBe("heart_rate_activity_not_judged");
  });

  test("a raised heart rate while still is worth a look, under the placeholder threshold", () => {
    const still = find("heart_rate", "elevated_still");
    expect(still.status.status).toBe("worth_a_look");
    expect(still.status.words).toBe("Worth a look");
    expect(still.status.rule.basis).toBe("placeholder_threshold");
    expect(still.status.rule.text).toContain("placeholder");
  });

  test("dinner past 140 mg/dL is worth a look; breakfast's rise notable; lunch with a walk usual", () => {
    expect(find("glucose", "dinner").status.status).toBe("worth_a_look");
    expect(find("glucose", "breakfast").status.status).toBe("notable");
    expect(find("glucose", "breakfast").status.reason).toMatch(/^Rose \d+ mg\/dL/);
    expect(find("glucose", "lunch_with_walking").status.status).toBe("usual");
  });

  test("sleep is compared with the personal resting baseline", () => {
    const sleep = find("heart_rate", "sleep");
    expect(sleep.status.rule.id).toBe("heart_rate_near_resting_baseline");
    expect(sleep.status.reason).toContain("resting baseline of 54 /min");
  });

  test("recovery to the minute, from minute readings", () => {
    const recovery = find("heart_rate", "recovery");
    expect(recovery.status.status).toBe("usual");
    expect(recovery.status.reason).toContain("read 1 minute(s) apart");
  });

  test("standing still in the hour after a run or walk is not a raised heart rate while still", () => {
    const after = (time: string, minutes: number) => {
      const from = localInstant(DEMO_REFERENCE_DAY, time, DEMO_TIME_ZONE).getTime();
      return (one: Readonly<{ at: string }>): boolean =>
        Date.parse(one.at) >= from && Date.parse(one.at) < from + minutes * 60_000;
    };
    const stood = replayDaySchema.parse({
      ...REFERENCE,
      readings: REFERENCE.readings.map((one) =>
        one.stream === "steps" && (after("18:45", 60)(one) || after("13:15", 60)(one))
          ? { ...one, value: 10 }
          : one,
      ),
    });
    const still = phasesOf(stood).filter((one) => one.phase === "elevated_still");
    expect(still.map((one) => [clock(one.from), clock(one.to)])).toEqual([
      ["15:00", "15:45"],
    ]);
  });

  test("a run with one reading after it and then two hours of nothing is not enough data", () => {
    const runEnd = localInstant(DEMO_REFERENCE_DAY, "18:45", DEMO_TIME_ZONE).getTime();
    const gapped = replayDaySchema.parse({
      ...REFERENCE,
      readings: REFERENCE.readings.filter(
        (one) =>
          one.stream !== "heart_rate" ||
          Date.parse(one.at) <= runEnd + 60_000 ||
          Date.parse(one.at) >= runEnd + 120 * 60_000,
      ),
    });
    const recovery = phasesOf(gapped).find((one) => one.phase === "recovery");
    expect(recovery?.status.status).toBe("insufficient_data");
    expect(recovery?.status.reason).toBe(
      "Heart rate was not read through the hour after the run, so whether it came back cannot be said.",
    );
  });

  test("without a baseline, sleep and resting are not enough data, never usual", () => {
    const b = phasesOf(day(DEMO_PERSON_B, "2026-10-27"));
    const judged = b.filter((one) => one.phase === "sleep" || one.phase === "resting");
    expect(judged.length).toBe(2);
    for (const phase of judged) {
      expect(phase.status.status).toBe("insufficient_data");
      expect(phase.status.reason).toContain("No personal resting baseline");
    }
  });

  test("on recorded data no rule classifies yet: not classified, with why", () => {
    const recorded = replayDaySchema.parse(
      JSON.parse(
        JSON.stringify({ ...REFERENCE, notice: null }).replaceAll(
          '"origin":"synthetic_demo"',
          '"origin":"recorded"',
        ),
      ),
    );
    const phases = storyPhases(recorded, {
      restingBaseline: {
        state: "insufficient",
        stream: "resting_heart_rate",
        n: 0,
        needed: 7,
        text: "None.",
      },
    });
    expect(phases).toHaveLength(PHASES.length);
    const needBaseline = (one: StoryPhase): boolean =>
      one.phase === "sleep" || one.phase === "resting";
    expect(
      new Set(phases.filter((one) => !needBaseline(one)).map((one) => one.status.status)),
    ).toEqual(new Set(["not_classified"]));
    expect(phases.find((one) => one.phase === "walking")?.status.reason).toContain(
      "not approved for recorded data",
    );
    // Without a baseline there is nothing to judge, and that is said on any origin.
    expect(new Set(phases.filter(needBaseline).map((one) => one.status.status))).toEqual(
      new Set(["insufficient_data"]),
    );
  });
});

describe("narration", () => {
  const narrated = PHASES.flatMap((one) =>
    one.narration === null ? [] : [one.narration],
  );

  test("insulin is narrated after each meal, at the pancreas, with no number", () => {
    const insulin = narrated.filter((one) => one.topic === "insulin");
    expect(insulin).toHaveLength(3);
    for (const one of insulin) {
      expect(one.provenance).toBe("narrated");
      expect(one.focus).toBe("pancreas");
      expect(/\d/.test(one.text)).toBe(false);
    }
  });

  test("every narration parses as narration and belongs to the day", () => {
    for (const one of narrated) {
      expect(replayNarrationSchema.safeParse(one).success).toBe(true);
      expect([one.subject_ref, one.day, one.origin]).toEqual([
        REFERENCE.subject_ref,
        REFERENCE.day,
        REFERENCE.origin,
      ]);
    }
  });

  test("the raised heart rate is narrated without a cause", () => {
    expect(find("heart_rate", "elevated_still").narration?.text).toContain(
      "The data alone cannot say why.",
    );
  });
});

describe("no evidence, no phase", () => {
  test("a day with nothing recorded has no phases", () => {
    expect(phasesOf(day(DEMO_PERSON_A, "2026-10-22"))).toEqual([]);
  });

  test("without steps or glucose: no glucose phase, no resting, no raised-while-still", () => {
    const partial = phasesOf(day(DEMO_PERSON_A, "2026-10-28"));
    expect(partial.some((one) => one.stream === "glucose")).toBe(false);
    expect(partial.map((one) => one.phase)).toEqual(["sleep", "waking", "winding_down"]);
  });

  test("after the ring stops syncing, no heart-rate phase is made from nothing", () => {
    const stale = phasesOf(day(DEMO_PERSON_A, "2026-10-23"));
    expect(
      stale.some((one) => one.stream === "heart_rate" && one.phase === "winding_down"),
    ).toBe(false);
    expect(stale.some((one) => one.stream === "glucose" && one.phase === "dinner")).toBe(
      true,
    );
  });

  test("only the winding-down tag starts winding down, not any word holding wind", () => {
    const windDown = REFERENCE.events.find((one) => one.id === "tag-wind-down");
    if (windDown === undefined) throw new Error("no winding-down tag");
    const surfed = replayDaySchema.parse({
      ...REFERENCE,
      events: [
        ...REFERENCE.events.filter((one) => one.id !== "tag-wind-down"),
        {
          ...windDown,
          id: "tag-windsurfing",
          label: "Windsurfing",
          from: localInstant(DEMO_REFERENCE_DAY, "10:00", DEMO_TIME_ZONE).toISOString(),
          to: localInstant(DEMO_REFERENCE_DAY, "11:00", DEMO_TIME_ZONE).toISOString(),
        },
      ],
    });
    const winding = phasesOf(surfed).filter((one) => one.phase === "winding_down");
    expect(
      winding.map((one) => [clock(one.from), one.evidence.includes("tag-windsurfing")]),
    ).toEqual([["22:45", false]]);
    expect(clock(find("heart_rate", "winding_down").from)).toBe("22:00");
  });

  test("on the 25-hour day, a nap at 11:30 is before local noon, not the evening's sleep", () => {
    const dst = day(DEMO_PERSON_A, DEMO_DST_DAY);
    const night = dst.events.find((one) => one.id === "sleep-night-before");
    if (night === undefined) throw new Error("no night before");
    const napped = replayDaySchema.parse({
      ...dst,
      events: [
        ...dst.events.filter((one) => one.id !== "tag-wind-down"),
        {
          ...night,
          id: "nap",
          from: localInstant(DEMO_DST_DAY, "11:30", DEMO_TIME_ZONE).toISOString(),
          to: localInstant(DEMO_DST_DAY, "11:50", DEMO_TIME_ZONE).toISOString(),
        },
      ],
    });
    const evening = phasesOf(napped).filter(
      (one) => one.phase === "winding_down" || one.phase === "return_to_sleep",
    );
    expect(evening.map((one) => [one.phase, clock(one.from)])).toEqual([
      ["winding_down", "22:45"],
      ["return_to_sleep", "22:45"],
    ]);
  });

  test("on the 25-hour day, sleep starts at the day's own midnight", () => {
    const dst = day(DEMO_PERSON_A, DEMO_DST_DAY);
    const sleep = phasesOf(dst).find((one) => one.phase === "sleep");
    expect(sleep?.from).toBe(
      localDayBounds(DEMO_DST_DAY, DEMO_TIME_ZONE).start.toISOString(),
    );
  });
});
