import { describe, expect, test } from "bun:test";

import { latticeCells, waveDelayMs } from "./status-lattice-model";

const drawn = (cells: readonly boolean[]): string =>
  [0, 1, 2]
    .map((row) =>
      cells
        .slice(row * 3, row * 3 + 3)
        .map((on) => (on ? "o" : "."))
        .join(""),
    )
    .join("/");

describe("latticeCells", () => {
  test("working lights every dot for the wave", () => {
    expect(drawn(latticeCells("working"))).toBe("ooo/ooo/ooo");
  });

  test("done draws a tick and error a cross", () => {
    expect(drawn(latticeCells("done"))).toBe("..o/o.o/.o.");
    expect(drawn(latticeCells("error"))).toBe("o.o/.o./o.o");
  });
});

describe("waveDelayMs", () => {
  test("runs corner to corner along the diagonals", () => {
    expect(Array.from({ length: 9 }, (_, i) => waveDelayMs(i))).toEqual([
      0, 110, 220, 110, 220, 330, 220, 330, 440,
    ]);
    expect(waveDelayMs(8, 50)).toBe(200);
  });
});
