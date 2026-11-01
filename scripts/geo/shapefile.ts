/**
 * A small reader for the two parts of an ESRI shapefile that Natural Earth
 * ships: polygon geometry (`.shp`) and its attribute table (`.dbf`). Only
 * what the boundary build needs: polygon and null shapes, character and
 * numeric fields. Pure: it parses bytes it is given and reads no files.
 */

export type Ring = readonly (readonly [number, number])[];

/** One record's rings, in file order; empty for a null shape. */
export type ShapeRecord = readonly Ring[];

const SHAPE_NULL = 0;
const SHAPE_POLYGON = 5;
const FILE_HEADER_BYTES = 100;
const RECORD_HEADER_BYTES = 8;

const polygonRings = (view: DataView, start: number): ShapeRecord => {
  const numParts = view.getInt32(start + 36, true);
  const numPoints = view.getInt32(start + 40, true);
  const partsAt = start + 44;
  const pointsAt = partsAt + numParts * 4;
  const offsets = Array.from({ length: numParts }, (_, index) =>
    view.getInt32(partsAt + index * 4, true),
  );
  return offsets.map((first, index) => {
    const last = index + 1 < numParts ? offsets[index + 1] : numPoints;
    return Array.from({ length: last - first }, (_, k) => {
      const at = pointsAt + (first + k) * 16;
      return [view.getFloat64(at, true), view.getFloat64(at + 8, true)] as const;
    });
  });
};

/** Every record of a polygon `.shp` file, in order. */
export const readShapes = (bytes: Uint8Array): ShapeRecord[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileBytes = view.getInt32(24, false) * 2;
  const records: ShapeRecord[] = [];
  let at = FILE_HEADER_BYTES;
  while (at + RECORD_HEADER_BYTES <= fileBytes) {
    const contentBytes = view.getInt32(at + 4, false) * 2;
    const start = at + RECORD_HEADER_BYTES;
    const type = view.getInt32(start, true);
    if (type === SHAPE_POLYGON) records.push(polygonRings(view, start));
    else if (type === SHAPE_NULL) records.push([]);
    else throw new Error(`shape type ${type} is not a polygon`);
    at = start + contentBytes;
  }
  return records;
};

type Field = Readonly<{ name: string; type: string; length: number }>;

const ascii = (bytes: Uint8Array): string =>
  new TextDecoder("latin1").decode(bytes).replace(/\0.*$/s, "");

const readFields = (bytes: Uint8Array): Field[] => {
  const fields: Field[] = [];
  for (let at = 32; bytes[at] !== 0x0d; at += 32) {
    fields.push({
      name: ascii(bytes.subarray(at, at + 11)),
      type: String.fromCharCode(bytes[at + 11]),
      length: bytes[at + 16],
    });
  }
  return fields;
};

export type DbfValue = string | number | null;

/** Every row of a `.dbf` table (UTF-8 text, as Natural Earth's `.cpg` says). */
export const readTable = (bytes: Uint8Array): Record<string, DbfValue>[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  const headerBytes = view.getUint16(8, true);
  const recordBytes = view.getUint16(10, true);
  const fields = readFields(bytes);
  const utf8 = new TextDecoder("utf-8");
  return Array.from({ length: count }, (_, row) => {
    const start = headerBytes + row * recordBytes + 1;
    return Object.fromEntries(
      fields.reduce<{ at: number; entries: [string, DbfValue][] }>(
        (acc, field) => {
          const raw = utf8
            .decode(bytes.subarray(acc.at, acc.at + field.length))
            .replace(/\0/g, "")
            .trim();
          const value: DbfValue =
            field.type === "N" || field.type === "F"
              ? raw === "" || !Number.isFinite(Number(raw))
                ? null
                : Number(raw)
              : raw === ""
                ? null
                : raw;
          return {
            at: acc.at + field.length,
            entries: [...acc.entries, [field.name, value]],
          };
        },
        { at: start, entries: [] },
      ).entries,
    );
  });
};
