import { describe, expect, test } from "bun:test";

import { readingAt } from "@/packages/query-tools/replay/at-time";
import { personalBaseline } from "@/packages/query-tools/replay/baseline";
import {
  DEMO_DST_DAY,
  DEMO_PERSON_A,
  DEMO_PERSON_B,
  DEMO_REFERENCE_DAY,
  demoReplayDay,
  demoReplayDays,
} from "@/packages/query-tools/replay/demo-days";
import { localClock, localInstant } from "@/packages/query-tools/replay/local-time";
import { storyPhases } from "@/packages/query-tools/replay/phases";

import {
  createReplayTransport,
  type ReplayFrameClock,
  type ReplaySpeed,
  type ReplayStory,
} from "./replay-transport";

function fakeClock() {
  let time = 0;
  let id = 0;
  const frames = new Map<number, () => void>();
  const clock: ReplayFrameClock = {
    now: () => time,
    request: (frame) => {
      frames.set(++id, frame);
      return id;
    },
    cancel: (frameId) => {
      frames.delete(frameId);
    },
  };

  return {
    clock,
    pending: () => [...frames.values()],
    advance(ms: number, frame = true) {
      time += ms;
      if (!frame) return;
      const ready = [...frames.values()];
      frames.clear();
      for (const tick of ready) tick();
    },
  };
}

function demo(subject: string, date: string) {
  const day = demoReplayDay(subject, date);
  if (day === null) throw new Error("Demo day not found");
  return day;
}

const reference = demo(DEMO_PERSON_A, DEMO_REFERENCE_DAY);
const phases = storyPhases(reference, {
  restingBaseline: personalBaseline(
    demoReplayDays(DEMO_PERSON_A),
    reference,
    "resting_heart_rate",
  ),
});
const story: ReplayStory = { selection: reference, phases };

function setup(selection = reference, cards: ReplayStory | null = story) {
  const time = fakeClock();
  const transport = createReplayTransport(selection, time.clock);
  const disconnect = transport.connect();
  transport.setStory(cards);
  return { time, transport, disconnect, state: transport.getSnapshot };
}

describe("replay transport", () => {
  test.each([
    ["default", 270_000, 330_000],
    ["fast", 40_000, 50_000],
  ] as const)("plays the reference day at %s speed", (speed: ReplaySpeed, min, max) => {
    const { time, transport, state } = setup();
    const starts = [...new Set(phases.map(({ from }) => Date.parse(from)))].sort(
      (a, b) => a - b,
    );
    expect(phases).toHaveLength(16);
    expect(starts.length).toBeLessThan(phases.length);
    const holds = new Map<number, number>();
    transport.actions.setSpeed(speed);
    transport.actions.play();
    let elapsed = 0;
    while (state().status === "playing" && elapsed <= max) {
      const before = state();
      time.advance(20);
      elapsed += 20;
      if (before.holding && state().cursorMs === before.cursorMs) {
        holds.set(before.cursorMs, (holds.get(before.cursorMs) ?? 0) + 20);
      }
    }
    expect(elapsed).toBeGreaterThanOrEqual(min);
    expect(elapsed).toBeLessThanOrEqual(max);
    expect(state()).toMatchObject({ status: "ended", cursorMs: state().endMs - 1 });
    expect(time.pending()).toHaveLength(0);
    if (speed === "default") {
      expect([...holds.keys()]).toEqual(starts);
      for (const duration of holds.values())
        expect(duration).toBeGreaterThanOrEqual(3_000);
    } else {
      expect(holds.size).toBe(0);
    }
  });

  test("publishes a seek to every subscriber immediately, including while paused", () => {
    const { transport, state, time } = setup();
    const cursorMs = localInstant(reference.day, "18:35", reference.time_zone).getTime();
    const observations: { at: number; bpm: number | null }[] = [];
    transport.subscribe(() => {
      const { cursorMs } = state();
      const reading = readingAt(reference, { stream: "heart_rate" }, new Date(cursorMs));
      observations.push({
        at: cursorMs,
        bpm: reading.state === "available" ? reading.reading.value : null,
      });
    });
    const unsubscribe = transport.subscribe(() =>
      expect(state().cursorMs).toBe(cursorMs),
    );
    transport.actions.seek(cursorMs);
    expect(observations).toEqual([{ at: cursorMs, bpm: 167 }]);
    expect(state().status).toBe("paused");
    expect(time.pending()).toHaveLength(0);
    unsubscribe();
    transport.actions.setSpeed("fast");
    expect(observations.at(-1)).toEqual(observations[0]);
    expect(state().cursorMs).toBe(cursorMs);
  });

  test("pauses a hold, resumes its remaining time, and drops it on seeks", () => {
    const start = localInstant(reference.day, "01:00", reference.time_zone).getTime();
    const { time, transport, state } = setup(reference, {
      selection: reference,
      phases: [{ from: new Date(start).toISOString() }],
    });
    transport.actions.play();
    time.advance(20_000);
    expect(state()).toMatchObject({ cursorMs: start, holding: true });
    time.advance(500, false);
    transport.actions.pause();
    time.advance(10_000);
    expect(state()).toMatchObject({ status: "paused", cursorMs: start, holding: true });
    transport.actions.play();
    time.advance(2_499);
    expect(state()).toMatchObject({ cursorMs: start, holding: true });
    transport.actions.seek(start);
    expect(state()).toMatchObject({ status: "playing", cursorMs: start, holding: false });
    time.advance(100);
    expect(state().cursorMs).toBeGreaterThan(start);
    transport.actions.seek(start - 1);
    time.advance(100);
    expect(state()).toMatchObject({ cursorMs: start, holding: true });
    transport.actions.pause();
    transport.actions.seek(start + 600_000);
    expect(state()).toMatchObject({ status: "paused", holding: false });
    transport.actions.play();
    time.advance(100);
    expect(state().cursorMs).toBeGreaterThan(start + 600_000);
  });

  test("switches speed without a jump and keeps only one scheduled frame", () => {
    const { time, transport, state } = setup(reference, null);
    transport.actions.play();
    transport.actions.play();
    time.advance(1_000);
    const slow = state().cursorMs;
    transport.actions.setSpeed("fast");
    expect(state().cursorMs).toBe(slow);
    expect(time.pending()).toHaveLength(1);
    time.advance(1_000);
    expect(state().cursorMs - slow).toBeGreaterThan(slow - state().startMs);
  });

  test("keeps the terminal cursor in the selected day and replays it at the chosen speed", () => {
    const { time, transport, state } = setup(reference, null);
    const { actions } = transport;
    const { startMs, endMs } = state();
    actions.setSpeed("fast");
    actions.seek(endMs + 100);
    expect(state()).toMatchObject({ status: "paused", cursorMs: endMs - 1 });
    actions.seek(startMs - 100);
    expect(state().cursorMs).toBe(startMs);
    actions.play();
    time.advance(45_000);
    expect(state()).toMatchObject({ status: "ended", cursorMs: endMs - 1 });
    actions.seek(endMs - 60_000);
    expect(state()).toMatchObject({ status: "paused", cursorMs: endMs - 60_000 });
    actions.replay();
    expect(state()).toMatchObject({
      status: "playing",
      cursorMs: startMs,
      speed: "fast",
    });
    expect(() => actions.seek(Number.NaN)).toThrow(RangeError);
  });

  test("steps by 15 elapsed minutes across the repeated local hour", () => {
    const selection = demo(DEMO_PERSON_A, DEMO_DST_DAY);
    const { transport, state } = setup(selection, null);
    expect(state().endMs - state().startMs).toBe(25 * 3_600_000);
    transport.actions.seek(Date.parse("2026-10-25T00:45:00Z"));
    transport.actions.step(1);
    expect(state().cursorMs).toBe(Date.parse("2026-10-25T01:00:00Z"));
    expect(localClock(new Date(state().cursorMs), selection.time_zone)).toMatchObject({
      time: "02:00",
      offset: "+01:00",
    });
    transport.actions.step(-1);
    expect(state().cursorMs).toBe(Date.parse("2026-10-25T00:45:00Z"));
  });

  test("disconnect invalidates old frames and actions on person/date changes or leaving", () => {
    const old = setup();
    old.transport.actions.play();
    const [late] = old.time.pending();
    old.disconnect();
    expect(old.time.pending()).toHaveLength(0);
    const next = setup(demo(DEMO_PERSON_B, "2026-10-28"), story);
    const original = old.state();
    late();
    old.transport.actions.replay();
    expect(old.state()).toBe(original);
    expect(old.time.pending()).toHaveLength(0);
    expect(next.state()).toMatchObject({
      selection: { subject_ref: DEMO_PERSON_B, day: "2026-10-28" },
      status: "paused",
      holding: false,
    });
    // The old frame also stays invalid if React reconnects this store in Strict Mode.
    old.transport.connect();
    old.transport.actions.play();
    late();
    expect(old.time.pending()).toHaveLength(1);
  });

  test("replaces late story starts without resetting the cursor or using another person's cards", () => {
    const { time, transport, state } = setup(reference, null);
    const start = state().startMs + 60_000;
    const phases = [{ from: new Date(start).toISOString() }];
    transport.actions.play();
    transport.setStory({
      selection: { ...reference, subject_ref: DEMO_PERSON_B },
      phases,
    });
    time.advance(500);
    expect(state().holding).toBe(false);
    const before = state();
    const later = before.cursorMs + 60_000;
    transport.setStory({
      selection: reference,
      phases: [{ from: new Date(later).toISOString() }],
    });
    expect(state()).toBe(before);
    time.advance(500);
    expect(state()).toMatchObject({ cursorMs: later, holding: true });
    transport.setStory(null);
    expect(state()).toMatchObject({ cursorMs: later, holding: false, status: "playing" });
  });
});
