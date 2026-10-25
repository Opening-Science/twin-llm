import { describe, expect, test } from "bun:test";

import { createWheelGate, HINT_MS, WHEEL_ZOOM_HINT, wheelZooms } from "./wheel-zoom";

const plain = { inEnvironment: false, focused: false, ctrlKey: false, metaKey: false };

describe("wheelZooms", () => {
  test("a plain wheel over the inline view scrolls the page", () => {
    expect(wheelZooms(plain)).toBe(false);
  });

  test("Ctrl, ⌘ (and so a trackpad pinch) or a focused view zoom", () => {
    expect(wheelZooms({ ...plain, ctrlKey: true })).toBe(true);
    expect(wheelZooms({ ...plain, metaKey: true })).toBe(true);
    expect(wheelZooms({ ...plain, focused: true })).toBe(true);
  });

  test("the environment always zooms", () => {
    expect(wheelZooms({ ...plain, inEnvironment: true })).toBe(true);
  });
});

describe("createWheelGate", () => {
  const setup = (focused = false) => {
    const hints: boolean[] = [];
    const timers: { ms: number; done: () => void; cancelled: boolean }[] = [];
    let hinted = false;
    const gate = createWheelGate({
      focused: () => focused,
      hinted: () => hinted,
      markHinted: () => {
        hinted = true;
      },
      setHint: (shown) => hints.push(shown),
      later: (done, ms) => {
        const timer = { ms, done, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });
    return { gate, hints, timers };
  };
  const wheel = (keys: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) => {
    const calls = { stopped: 0 };
    return {
      calls,
      event: {
        ctrlKey: false,
        metaKey: false,
        ...keys,
        stopPropagation: () => {
          calls.stopped += 1;
        },
      },
    };
  };

  test("a plain wheel never reaches the controls; Ctrl or ⌘ does", () => {
    const { gate } = setup();
    const plain = wheel();
    gate.onWheel(plain.event);
    expect(plain.calls.stopped).toBe(1);
    for (const keys of [{ ctrlKey: true }, { metaKey: true }]) {
      const zoom = wheel(keys);
      gate.onWheel(zoom.event);
      expect(zoom.calls.stopped).toBe(0);
    }
  });

  test("a focused view zooms without keys and shows no hint", () => {
    const { gate, hints } = setup(true);
    const focused = wheel();
    gate.onWheel(focused.event);
    expect(focused.calls.stopped).toBe(0);
    expect(hints).toEqual([]);
  });

  test("the hint shows once and hides after its time", () => {
    const { gate, hints, timers } = setup();
    gate.onWheel(wheel().event);
    gate.onWheel(wheel().event);
    expect(hints).toEqual([true]);
    expect(timers.map((timer) => timer.ms)).toEqual([HINT_MS]);
    timers[0]!.done();
    expect(hints).toEqual([true, false]);
  });

  test("disposing, as entering the environment does, hides a showing hint", () => {
    const { gate, hints, timers } = setup();
    gate.onWheel(wheel().event);
    gate.dispose();
    expect(hints).toEqual([true, false]);
    expect(timers[0]!.cancelled).toBe(true);
  });

  test("the hint names both ways to zoom", () => {
    expect(WHEEL_ZOOM_HINT).toBe("Ctrl/⌘ + scroll, or click the view, to zoom");
  });
});
