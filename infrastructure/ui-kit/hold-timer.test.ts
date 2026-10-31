import { describe, expect, test } from "bun:test";

import { createHoldTimer, createSubmitGate, type HoldClock } from "./hold-timer";

/** A clock the test moves by hand: `advance` runs every timer that is due. */
const fakeClock = () => {
  const timers: Readonly<{ id: number; at: number; run: () => void }>[] = [];
  const settled = new Set<number>();
  const state = { now: 0 };
  const clock: HoldClock = (run, ms) => {
    const id = timers.length;
    timers.push({ id, at: state.now + ms, run });
    return () => void settled.add(id);
  };
  const advance = (ms: number) => {
    state.now += ms;
    timers
      .filter((timer) => !settled.has(timer.id) && timer.at <= state.now)
      .forEach((timer) => {
        settled.add(timer.id);
        timer.run();
      });
  };
  return { clock, advance, now: () => state.now };
};

const setUp = (holdMs = 1500) => {
  const fake = fakeClock();
  const fired: number[] = [];
  const timer = createHoldTimer(
    holdMs,
    () => fired.push(fake.now()),
    fake.clock,
    fake.now,
  );
  return { ...fake, fired, timer };
};

describe("createHoldTimer", () => {
  test("a full hold fires once, at the end", () => {
    const { timer, advance, fired } = setUp();
    expect(timer.press()).toBe(true);
    advance(1499);
    expect(fired).toEqual([]);
    advance(1);
    expect(fired).toEqual([1500]);
    advance(5000);
    expect(fired).toEqual([1500]);
  });

  test("letting go early cancels, and nothing fires later", () => {
    const { timer, advance, fired } = setUp();
    timer.press();
    advance(1000);
    expect(timer.letGo()).toBe(true);
    advance(5000);
    expect(fired).toEqual([]);
    expect(timer.startedAt()).toBe(null);
  });

  test("after an early release a new full hold fires once", () => {
    const { timer, advance, fired } = setUp();
    timer.press();
    advance(700);
    timer.letGo();
    expect(timer.press()).toBe(true);
    advance(1500);
    expect(fired).toEqual([2200]);
  });

  test("a second press while holding does not start a second timer", () => {
    const { timer, advance, fired } = setUp();
    expect(timer.press()).toBe(true);
    advance(500);
    expect(timer.press()).toBe(false);
    advance(1000);
    expect(fired).toEqual([1500]);
    advance(500);
    expect(fired).toEqual([1500]);
  });

  test("a completed hold cannot be pressed or released again", () => {
    const { timer, advance, fired } = setUp(1000);
    timer.press();
    advance(1000);
    expect(timer.press()).toBe(false);
    expect(timer.letGo()).toBe(false);
    advance(2000);
    expect(fired).toEqual([1000]);
  });

  test("letting go without a press does nothing", () => {
    const { timer } = setUp();
    expect(timer.letGo()).toBe(false);
  });

  test("startedAt reports when the running hold began", () => {
    const { timer, advance } = setUp();
    advance(300);
    timer.press();
    expect(timer.startedAt()).toBe(300);
    advance(1500);
    expect(timer.startedAt()).toBe(null);
  });
});

describe("createSubmitGate", () => {
  test("turns away a submission no hold opened it for", () => {
    expect(createSubmitGate().admit()).toBe(false);
  });

  test("admits exactly one submission per completed hold", () => {
    const gate = createSubmitGate();
    gate.open();
    expect(gate.admit()).toBe(true);
    expect(gate.admit()).toBe(false);
  });

  test("a hold, its submission, then Enter in a field: only the first goes", () => {
    const gate = createSubmitGate();
    const admitted = [
      gate.admit(),
      (gate.open(), gate.admit()),
      gate.admit(),
      gate.admit(),
    ];
    expect(admitted).toEqual([false, true, false, false]);
  });
});

describe("a hold that submits a form", () => {
  test("fires the submit once at the end and never on an early release", () => {
    const fake = fakeClock();
    const gate = createSubmitGate();
    const submitted: number[] = [];
    const submit = () => {
      if (gate.admit()) submitted.push(fake.now());
    };
    const early = createHoldTimer(
      1500,
      () => {
        gate.open();
        submit();
      },
      fake.clock,
      fake.now,
    );
    early.press();
    fake.advance(1200);
    early.letGo();
    submit(); // Enter pressed in a field meanwhile
    fake.advance(3000);
    expect(submitted).toEqual([]);

    const full = createHoldTimer(
      1500,
      () => {
        gate.open();
        submit();
      },
      fake.clock,
      fake.now,
    );
    full.press();
    fake.advance(1500);
    submit();
    fake.advance(3000);
    expect(submitted).toEqual([5700]);
  });
});
