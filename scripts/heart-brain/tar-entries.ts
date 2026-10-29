/**
 * Reads a tar stream entry by entry, so a 40 GB batch archive never has to be
 * unpacked to disk. Only one entry's bytes are held at a time. Handles plain
 * ustar headers, GNU long names (`L`) and pax `path` records (`x`), which is
 * what GNU tar writes for the Synthea batches. Pure apart from consuming the
 * iterable it is given.
 */

export const BLOCK = 512;

export type TarHeader = Readonly<{
  name: string;
  size: number;
  /** "0" or "" for a file, "5" a directory, "L" a GNU long name, "x" a pax record. */
  type: string;
}>;

export type TarEntry = Readonly<{ name: string; bytes: Uint8Array }>;

const decoder = new TextDecoder();

const field = (block: Uint8Array, start: number, length: number): string => {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
};

/** The size field: octal text, or GNU base-256 when the top bit is set. */
const sizeOf = (block: Uint8Array): number => {
  if (((block[124] ?? 0) & 0x80) !== 0) {
    return Array.from(block.subarray(125, 136)).reduce(
      (total, byte) => total * 256 + byte,
      0,
    );
  }
  const text = field(block, 124, 12).trim();
  return text === "" ? 0 : Number.parseInt(text, 8);
};

/** One 512-byte header, or null for the all-zero block that ends an archive. */
export const parseTarHeader = (block: Uint8Array): TarHeader | null => {
  if (block.every((byte) => byte === 0)) return null;
  const name = field(block, 0, 100);
  const magic = field(block, 257, 6);
  const prefix = magic.startsWith("ustar") ? field(block, 345, 155) : "";
  return {
    name: prefix === "" ? name : `${prefix}/${name}`,
    size: sizeOf(block),
    type: field(block, 156, 1),
  };
};

/** The `path` value of a pax extended header, or null when it has none. */
export const paxPath = (bytes: Uint8Array): string | null => {
  const line = decoder
    .decode(bytes)
    .split("\n")
    .find((record) => / path=/.test(record));
  return line === undefined ? null : line.slice(line.indexOf(" path=") + 6);
};

const paddedSize = (size: number): number => Math.ceil(size / BLOCK) * BLOCK;

/** Collects bytes from a chunk stream into blocks of exactly the size asked for. */
const reader = (chunks: AsyncIterable<Uint8Array>) => {
  const iterator = chunks[Symbol.asyncIterator]();
  let pending: Uint8Array = new Uint8Array(0);
  /** Exactly `size` bytes, or null when the stream ends first. */
  const take = async (size: number): Promise<Uint8Array | null> => {
    const out = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      if (pending.length === 0) {
        const next = await iterator.next();
        if (next.done) return null;
        pending = next.value;
        continue;
      }
      const count = Math.min(size - filled, pending.length);
      out.set(pending.subarray(0, count), filled);
      pending = pending.subarray(count);
      filled += count;
    }
    return out;
  };
  return { take };
};

/** Regular files of a tar stream, in archive order. */
export async function* tarEntries(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<TarEntry> {
  const { take } = reader(chunks);
  let longName: string | null = null;
  for (;;) {
    const block = await take(BLOCK);
    if (block === null) return;
    const header = parseTarHeader(block);
    if (header === null) return;
    const body = await take(paddedSize(header.size));
    if (body === null) throw new Error(`tar stream ends inside ${header.name}`);
    const bytes = body.subarray(0, header.size);
    if (header.type === "L") {
      longName = field(bytes, 0, bytes.length);
      continue;
    }
    if (header.type === "x") {
      longName = paxPath(bytes) ?? longName;
      continue;
    }
    const name = longName ?? header.name;
    longName = null;
    if (header.type === "0" || header.type === "") yield { name, bytes };
  }
}
