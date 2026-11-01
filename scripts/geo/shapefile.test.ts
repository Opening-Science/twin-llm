import { describe, expect, test } from "bun:test";

import { readShapes, readTable } from "./shapefile";

/** A .shp with one polygon of two rings and one null shape, built by hand. */
const shapeFile = (): Uint8Array => {
  const rings = [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ],
    [
      [5, 5],
      [5, 6],
      [6, 6],
      [5, 5],
    ],
  ];
  const points = rings.flat();
  const polygonBytes = 44 + rings.length * 4 + points.length * 16;
  const total = 100 + 8 + polygonBytes + 8 + 4;
  const view = new DataView(new ArrayBuffer(total));
  view.setInt32(24, total / 2, false);
  view.setInt32(100, 1, false);
  view.setInt32(104, polygonBytes / 2, false);
  view.setInt32(108, 5, true);
  view.setInt32(108 + 36, rings.length, true);
  view.setInt32(108 + 40, points.length, true);
  view.setInt32(108 + 44, 0, true);
  view.setInt32(108 + 48, 4, true);
  points.forEach(([x, y], index) => {
    view.setFloat64(108 + 52 + index * 16, x, true);
    view.setFloat64(108 + 52 + index * 16 + 8, y, true);
  });
  const nullAt = 108 + polygonBytes;
  view.setInt32(nullAt, 2, false);
  view.setInt32(nullAt + 4, 2, false);
  view.setInt32(nullAt + 8, 0, true);
  return new Uint8Array(view.buffer);
};

/** A .dbf with a text and a number field and two rows, NUL-padded as Natural Earth's are. */
const tableFile = (): Uint8Array => {
  const fields = [
    { name: "NAME", type: "C", length: 8 },
    { name: "POP", type: "N", length: 5 },
  ];
  const headerBytes = 32 + fields.length * 32 + 1;
  const recordBytes = 1 + 8 + 5;
  const bytes = new Uint8Array(headerBytes + 2 * recordBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setUint16(8, headerBytes, true);
  view.setUint16(10, recordBytes, true);
  fields.forEach((field, index) => {
    const at = 32 + index * 32;
    bytes.set(new TextEncoder().encode(field.name), at);
    bytes[at + 11] = field.type.charCodeAt(0);
    bytes[at + 16] = field.length;
  });
  bytes[headerBytes - 1] = 0x0d;
  const write = (row: number, name: Uint8Array, pop: string) => {
    const at = headerBytes + row * recordBytes;
    bytes[at] = 0x20;
    bytes.set(name, at + 1);
    bytes.set(new TextEncoder().encode(pop.padStart(5, " ")), at + 9);
  };
  write(0, new TextEncoder().encode("Côte"), "42");
  write(1, new Uint8Array(0), "");
  return bytes;
};

describe("readShapes", () => {
  test("reads polygon rings and null shapes in order", () => {
    expect(readShapes(shapeFile())).toEqual([
      [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [0, 0],
        ],
        [
          [5, 5],
          [5, 6],
          [6, 6],
          [5, 5],
        ],
      ],
      [],
    ]);
  });
});

describe("readTable", () => {
  test("reads UTF-8 text and numbers, empty as null", () => {
    expect(readTable(tableFile())).toEqual([
      { NAME: "Côte", POP: 42 },
      { NAME: null, POP: null },
    ]);
  });
});
