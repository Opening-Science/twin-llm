import { describe, expect, test } from "bun:test";

import { eventLine, readEvents } from "./gbd-import-events";

describe("GBD import events (#426)", () => {
  test("one JSON line per event; an unfinished line waits", () => {
    const text =
      eventLine({ type: "progress", bytes: 10, rows: 2 }) +
      eventLine({ type: "already-imported", sha256: "a" }) +
      '{"type":"imp';
    expect(readEvents(text)).toEqual({
      events: [
        { type: "progress", bytes: 10, rows: 2 },
        { type: "already-imported", sha256: "a" },
      ],
      rest: '{"type":"imp',
    });
  });

  test("lines that are not events are left out", () => {
    expect(readEvents('not json\n{"type":"other"}\n\n').events).toEqual([]);
  });
});
