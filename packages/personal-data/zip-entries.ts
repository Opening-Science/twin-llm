import { Inflate, inflateSync } from "fflate";

/**
 * Reads a zip archive held in memory (an Apple Health or wearable export).
 * The central directory gives each entry's name, method and compressed
 * bytes; ZIP64 sizes and offsets are read from the extra field. Stored and
 * deflated entries are read; encrypted ones and other methods are reported
 * as unreadable. Entries are inflated in chunks so a large `export.xml`
 * never has to sit in memory whole.
 */

export type ZipEntry = Readonly<{
  name: string;
  method: number;
  encrypted: boolean;
  compressed: Uint8Array;
}>;

export type ZipListing =
  Readonly<{ ok: true; entries: readonly ZipEntry[] }> | Readonly<{ ok: false }>;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END = 0x06064b50;
const ZIP64_EXTRA = 0x0001;
const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;

const STORED = 0;
const DEFLATED = 8;

/** Bytes per push when inflating; small enough to keep memory flat. */
const CHUNK_BYTES = 1 << 20;

export const isZip = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

const findEndOfDirectory = (view: DataView): number | null => {
  const last = view.byteLength - 22;
  const first = Math.max(0, last - MAX_16);
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at;
  }
  return null;
};

type Directory = Readonly<{ count: number; offset: number }>;

const directoryOf = (view: DataView, end: number): Directory | null => {
  const count = view.getUint16(end + 10, true);
  const offset = view.getUint32(end + 16, true);
  if (count !== MAX_16 && offset !== MAX_32) return { count, offset };
  const locator = end - 20;
  if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR) return null;
  const zip64End = Number(view.getBigUint64(locator + 8, true));
  if (zip64End + 56 > view.byteLength || view.getUint32(zip64End, true) !== ZIP64_END) {
    return null;
  }
  return {
    count: Number(view.getBigUint64(zip64End + 32, true)),
    offset: Number(view.getBigUint64(zip64End + 48, true)),
  };
};

type Sizes = Readonly<{ compressedSize: number; localOffset: number }>;

/** ZIP64 extra field: the 64-bit values appear only for fields set to 0xFFFFFFFF. */
const zip64Sizes = (
  view: DataView,
  extraStart: number,
  extraLength: number,
  raw: Readonly<{ uncompressed: number; compressed: number; offset: number }>,
): Sizes => {
  const fallback = { compressedSize: raw.compressed, localOffset: raw.offset };
  const extraEnd = extraStart + extraLength;
  for (let at = extraStart; at + 4 <= extraEnd;) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === ZIP64_EXTRA) {
      const fields = [raw.uncompressed, raw.compressed, raw.offset];
      const values = fields.reduce<{ next: number; out: number[] }>(
        (state, field) =>
          field === MAX_32 && state.next + 8 <= at + 4 + size
            ? {
                next: state.next + 8,
                out: [...state.out, Number(view.getBigUint64(state.next, true))],
              }
            : { next: state.next, out: [...state.out, field] },
        { next: at + 4, out: [] },
      ).out;
      return { compressedSize: values[1]!, localOffset: values[2]! };
    }
    at += 4 + size;
  }
  return fallback;
};

const NAME_DECODER = new TextDecoder("utf-8");

export const readZipEntries = (bytes: Uint8Array): ZipListing => {
  if (bytes.byteLength < 22) return { ok: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfDirectory(view);
  if (end === null) return { ok: false };
  const directory = directoryOf(view, end);
  if (directory === null) return { ok: false };
  const entries: ZipEntry[] = [];
  let at = directory.offset;
  for (let index = 0; index < directory.count; index += 1) {
    if (at + 46 > view.byteLength || view.getUint32(at, true) !== CENTRAL_HEADER) {
      return { ok: false };
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = NAME_DECODER.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const sizes = zip64Sizes(view, at + 46 + nameLength, extraLength, {
      uncompressed: view.getUint32(at + 24, true),
      compressed: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true),
    });
    const local = sizes.localOffset;
    if (local + 30 > view.byteLength || view.getUint32(local, true) !== LOCAL_HEADER) {
      return { ok: false };
    }
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (dataStart + sizes.compressedSize > view.byteLength) return { ok: false };
    entries.push({
      name,
      method,
      encrypted: (flags & 1) === 1,
      compressed: bytes.subarray(dataStart, dataStart + sizes.compressedSize),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, entries };
};

const readable = (entry: ZipEntry): boolean =>
  !entry.encrypted && (entry.method === STORED || entry.method === DEFLATED);

/**
 * Hands an entry's bytes to `onChunk` in order. False when the entry cannot
 * be read (encrypted, an unknown method, or broken deflate data).
 */
export const streamZipEntry = (
  entry: ZipEntry,
  onChunk: (chunk: Uint8Array) => void,
): boolean => {
  if (!readable(entry)) return false;
  const data = entry.compressed;
  const slices = Math.max(1, Math.ceil(data.byteLength / CHUNK_BYTES));
  try {
    if (entry.method === STORED) {
      for (let index = 0; index < slices; index += 1) {
        onChunk(data.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES));
      }
      return true;
    }
    const inflate = new Inflate((chunk) => onChunk(chunk));
    for (let index = 0; index < slices; index += 1) {
      inflate.push(
        data.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES),
        index === slices - 1,
      );
    }
    return true;
  } catch {
    return false;
  }
};

/** An entry's bytes whole, for small files; null when it cannot be read. */
export const zipEntryBytes = (entry: ZipEntry): Uint8Array | null => {
  if (!readable(entry)) return null;
  if (entry.method === STORED) return entry.compressed;
  try {
    return inflateSync(entry.compressed);
  } catch {
    return null;
  }
};

/** The name without folders: `apple_health_export/export.xml` is `export.xml`. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
