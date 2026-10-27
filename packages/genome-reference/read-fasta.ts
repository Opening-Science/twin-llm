import "server-only";

import { createReadStream } from "node:fs";
import { access, open } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";

/**
 * Reads bases from a local per-chromosome FASTA: `<dir>/chr10.fa` (plain) or
 * `<dir>/chr10.fa.gz` (gzip or bgzip, as UCSC's hg38 `chromosomes/` ships).
 *
 * A plain file is read at an offset computed from its fixed line width, and
 * the bytes read are checked against that layout. A compressed file is
 * decompressed as a stream until the span is read; chr1 at 100 Mb is about a
 * second. Only public reference bytes are read here, never anything personal.
 */

export type FastaSpan = Readonly<{ chromosome: string; start: number; end: number }>;

export type FastaRead =
  | Readonly<{ ok: true; bases: string }>
  | Readonly<{
      ok: false;
      code: "REFERENCE_MISSING" | "REFERENCE_UNREADABLE";
      error: string;
    }>;

const CHROMOSOME = /^chr([1-9]|1\d|2[0-2]|X|Y|M)$/;

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const unreadable = (error: string): FastaRead => ({
  ok: false,
  code: "REFERENCE_UNREADABLE",
  error,
});

/** `>chr10 something` names chr10; anything else is the wrong file. */
const headerNames = (header: string, chromosome: string): boolean =>
  header.startsWith(">") && header.slice(1).split(/\s/)[0] === chromosome;

const HEAD_BYTES = 4096;

const readPlain = async (path: string, span: FastaSpan): Promise<FastaRead> => {
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0);
    const text = head.subarray(0, bytesRead).toString("latin1");
    const headerEnd = text.indexOf("\n");
    if (headerEnd < 0) return unreadable("no FASTA header line");
    const header = text.slice(0, headerEnd).replace(/\r$/, "");
    if (!headerNames(header, span.chromosome)) {
      return unreadable(`the file's header does not name ${span.chromosome}`);
    }
    const eol = text[headerEnd - 1] === "\r" ? 2 : 1;
    const firstLineEnd = text.indexOf("\n", headerEnd + 1);
    if (firstLineEnd < 0) return unreadable("no full sequence line in the first 4 KB");
    const width = firstLineEnd - (headerEnd + 1) - (eol - 1);
    if (width <= 0) return unreadable("empty first sequence line");
    const offsetOf = (base: number) =>
      headerEnd + 1 + base + Math.floor(base / width) * eol;
    const from = offsetOf(span.start);
    const to = offsetOf(span.end - 1) + 1;
    const buffer = Buffer.alloc(to - from);
    const read = await handle.read(buffer, 0, buffer.length, from);
    const raw = buffer.subarray(0, read.bytesRead).toString("latin1");
    // Newlines must sit exactly where a fixed line width puts them.
    const expectedBreaks =
      Math.floor((span.end - 1) / width) - Math.floor(span.start / width);
    const breaks = (raw.match(/\n/g) ?? []).length;
    const bases = raw.replace(/\r?\n/g, "");
    if (raw.includes(">")) return { ok: true, bases: bases.split(">")[0] ?? "" };
    if (read.bytesRead < buffer.length) return { ok: true, bases };
    if (breaks !== expectedBreaks || bases.length !== span.end - span.start) {
      return unreadable("line widths are not uniform; use a plain or gzipped UCSC file");
    }
    return { ok: true, bases };
  } finally {
    await handle.close();
  }
};

/** Streams a gzip/bgzip FASTA until `span` is read. */
const readCompressed = (path: string, span: FastaSpan): Promise<FastaRead> =>
  new Promise((resolve) => {
    const source = createReadStream(path);
    const gunzip = createGunzip();
    const state = { header: "", inHeader: true, seen: 0, bases: [] as string[] };
    const finish = (result: FastaRead) => {
      source.destroy();
      gunzip.destroy();
      resolve(result);
    };
    gunzip.on("data", (chunk: Buffer) => {
      const text = chunk.toString("latin1");
      const body = state.inHeader ? text.slice(Math.max(0, text.indexOf("\n"))) : text;
      if (state.inHeader) {
        const end = text.indexOf("\n");
        state.header += end < 0 ? text : text.slice(0, end);
        if (end < 0) return;
        state.inHeader = false;
        if (!headerNames(state.header.replace(/\r$/, ""), span.chromosome)) {
          finish(unreadable(`the file's header does not name ${span.chromosome}`));
          return;
        }
      }
      const sequence = body.replace(/[\r\n]/g, "");
      const stop = sequence.indexOf(">");
      const usable = stop < 0 ? sequence : sequence.slice(0, stop);
      const chunkStart = state.seen;
      const chunkEnd = chunkStart + usable.length;
      if (chunkEnd > span.start && chunkStart < span.end) {
        state.bases.push(
          usable.slice(
            Math.max(0, span.start - chunkStart),
            Math.min(usable.length, span.end - chunkStart),
          ),
        );
      }
      state.seen = chunkEnd;
      if (state.seen >= span.end || stop >= 0) {
        finish({ ok: true, bases: state.bases.join("") });
      }
    });
    gunzip.on("end", () => finish({ ok: true, bases: state.bases.join("") }));
    gunzip.on("error", () => finish(unreadable("the compressed file could not be read")));
    source.on("error", () => finish(unreadable("the file could not be opened")));
    source.pipe(gunzip);
  });

export const readFastaSpan = async (dir: string, span: FastaSpan): Promise<FastaRead> => {
  if (!CHROMOSOME.test(span.chromosome)) {
    return unreadable(`${span.chromosome} is not a chromosome name`);
  }
  const plain = join(dir, `${span.chromosome}.fa`);
  const compressed = `${plain}.gz`;
  try {
    if (await exists(plain)) return await readPlain(plain, span);
    if (await exists(compressed)) return await readCompressed(compressed, span);
  } catch (error) {
    console.error("[genome-reference] read failed", error);
    return unreadable("the reference file could not be read");
  }
  return {
    ok: false,
    code: "REFERENCE_MISSING",
    error: `no ${span.chromosome}.fa or ${span.chromosome}.fa.gz in GENOME_REFERENCE_DIR`,
  };
};
