import { brotliDecompressSync } from "node:zlib";

/**
 * A WOFF2 web font with CFF outlines back as the OpenType file it was packed
 * from, so a PDF can embed it (a PDF holds OpenType, not WOFF2). Only the
 * plain case is read: one font, "OTTO" flavour, every table stored as is
 * (WOFF2 transforms only TrueType `glyf`/`loca`, and optionally `hmtx`).
 * Anything else is null, never a guess. Nothing is written to disk.
 */

/** WOFF2's known-table tags, by index (WOFF2 spec, table 5.1). */
const KNOWN_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
] as const;

const HEADER_BYTES = 48;
const OTTO = 0x4f54544f;
const WOFF2 = 0x774f4632;

type Table = Readonly<{ tag: string; length: number }>;

/** UIntBase128 at `at`: the value and the offset after it, or null when malformed. */
const base128 = (
  view: DataView,
  at: number,
): Readonly<{ value: number; next: number }> | null => {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (at + index >= view.byteLength) return null;
    const byte = view.getUint8(at + index);
    if (index === 0 && byte === 0x80) return null;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: at + index + 1 };
  }
  return null;
};

const directoryOf = (
  view: DataView,
  count: number,
): Readonly<{ tables: Table[]; end: number }> | null => {
  const tables: Table[] = [];
  let at = HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (at >= view.byteLength) return null;
    const flags = view.getUint8(at);
    at += 1;
    const known = flags & 0x3f;
    let tag: string | undefined = KNOWN_TAGS[known];
    if (known === 0x3f) {
      if (at + 4 > view.byteLength) return null;
      tag = String.fromCharCode(
        view.getUint8(at),
        view.getUint8(at + 1),
        view.getUint8(at + 2),
        view.getUint8(at + 3),
      );
      at += 4;
    }
    if (tag === undefined) return null;
    // Version 0 is the null transform for every table but glyf and loca.
    if (flags >> 6 !== 0 || tag === "glyf" || tag === "loca") return null;
    const length = base128(view, at);
    if (length === null) return null;
    at = length.next;
    tables.push({ tag, length: length.value });
  }
  return { tables, end: at };
};

const checksum = (bytes: Uint8Array): number => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let at = 0; at < padded.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0;
  return sum;
};

/** The OpenType bytes, or null for anything but a plain CFF WOFF2. */
export const cffWoff2ToOpenType = (woff2: Uint8Array): Uint8Array | null => {
  if (woff2.length < HEADER_BYTES) return null;
  const view = new DataView(woff2.buffer, woff2.byteOffset, woff2.byteLength);
  if (view.getUint32(0) !== WOFF2 || view.getUint32(4) !== OTTO) return null;
  const count = view.getUint16(12);
  const compressedLength = view.getUint32(20);
  const directory = directoryOf(view, count);
  if (directory === null || count === 0) return null;
  const end = directory.end + compressedLength;
  if (end > woff2.length) return null;

  let data: Uint8Array;
  try {
    data = new Uint8Array(brotliDecompressSync(woff2.subarray(directory.end, end)));
  } catch {
    return null;
  }
  const total = directory.tables.reduce((sum, table) => sum + table.length, 0);
  if (total !== data.length) return null;

  let from = 0;
  const tables = directory.tables
    .map((table) => {
      const bytes = data.subarray(from, from + table.length);
      from += table.length;
      return { tag: table.tag, bytes };
    })
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const power = 2 ** Math.floor(Math.log2(count));
  const headerLength = 12 + 16 * count;
  const padded = (length: number) => Math.ceil(length / 4) * 4;
  const out = new Uint8Array(
    headerLength + tables.reduce((sum, table) => sum + padded(table.bytes.length), 0),
  );
  const write = new DataView(out.buffer);
  write.setUint32(0, OTTO);
  write.setUint16(4, count);
  write.setUint16(6, power * 16);
  write.setUint16(8, Math.log2(power));
  write.setUint16(10, count * 16 - power * 16);
  let offset = headerLength;
  tables.forEach((table, index) => {
    const record = 12 + 16 * index;
    for (let char = 0; char < 4; char += 1) {
      write.setUint8(record + char, table.tag.charCodeAt(char));
    }
    write.setUint32(record + 4, checksum(table.bytes));
    write.setUint32(record + 8, offset);
    write.setUint32(record + 12, table.bytes.length);
    out.set(table.bytes, offset);
    offset += padded(table.bytes.length);
  });
  return out;
};
