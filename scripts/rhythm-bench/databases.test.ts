import { describe, expect, test } from "bun:test";

import { DATABASES, pickBeats } from "./databases";

describe("pickBeats", () => {
  test("AF database: corrected beats first, detector beats otherwise", () => {
    const order = DATABASES.afdb.beatSources;
    expect(pickBeats(order, { qrsc: [1, 2], qrs: [3] })).toEqual({
      source: "qrsc",
      beats: [1, 2],
    });
    expect(pickBeats(order, { qrs: [3], atr: [] })).toEqual({
      source: "qrs",
      beats: [3],
    });
  });

  test("Long-term AF database: reviewed .atr beats, .qrs when .atr has none", () => {
    const order = DATABASES.ltafdb.beatSources;
    expect(pickBeats(order, { atr: [5, 9], qrs: [4, 8] })?.source).toBe("atr");
    expect(pickBeats(order, { atr: [], qrs: [4, 8] })).toEqual({
      source: "qrs",
      beats: [4, 8],
    });
  });

  test("no beats anywhere", () => {
    expect(pickBeats(DATABASES.ltafdb.beatSources, { atr: [] })).toBeNull();
    expect(pickBeats(DATABASES.afdb.beatSources, { atr: [1] })).toBeNull();
  });
});
