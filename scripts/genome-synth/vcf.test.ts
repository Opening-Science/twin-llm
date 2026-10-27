import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseCatalog, type Variant } from "./catalog";
import { callsFor } from "./genotypes";
import { GRCH38_CONTIGS, renderVcf, sampleName } from "./vcf";

const catalog = (): readonly Variant[] => {
  const parsed = parseCatalog(
    readFileSync(join(import.meta.dir, "variants.tsv"), "utf8"),
  );
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

const REF = "080b069b-5108-46b6-ecef-6aacd3b9ef3f";

type Record = Readonly<{ chrom: string; pos: number; id: string; gt: string }>;

/**
 * A strict reader for the subset of VCF 4.2 the generator writes: it throws on
 * anything a VCF parser would reject (undeclared contig, INFO key or FORMAT
 * field, unsorted or duplicate sites, bad alleles or genotypes, non-ASCII).
 */
const readVcf = (text: string) => {
  if (!text.endsWith("\n")) throw new Error("no final newline");
  const lines = text.slice(0, -1).split("\n");
  if (lines[0] !== "##fileformat=VCFv4.2")
    throw new Error("first line is not fileformat");
  const meta = lines.filter((line) => line.startsWith("##"));
  const headerAt = lines.findIndex((line) => line.startsWith("#CHROM"));
  if (headerAt !== meta.length) throw new Error("meta lines must all precede #CHROM");
  for (const line of meta) {
    if (!/^##[A-Za-z_]+=/.test(line)) throw new Error(`bad meta line: ${line}`);
    if (!/^[\x20-\x7e]*$/.test(line)) throw new Error(`non-ASCII meta line: ${line}`);
  }
  const contigs = new Map(
    meta.flatMap((line) => {
      const match = /^##contig=<ID=([^,>]+),length=(\d+)/.exec(line);
      return match?.[1] && match[2] ? [[match[1], Number(match[2])] as const] : [];
    }),
  );
  const declared = (kind: string) =>
    new Map(
      meta.flatMap((line) => {
        const match = new RegExp(
          `^##${kind}=<ID=([^,]+),Number=([^,]+),Type=([^,]+),`,
        ).exec(line);
        return match?.[1]
          ? [[match[1], { number: match[2], type: match[3] }] as const]
          : [];
      }),
    );
  const info = declared("INFO");
  const format = declared("FORMAT");
  const header = lines[headerAt]?.split("\t") ?? [];
  if (
    header.slice(0, 9).join("\t") !==
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT"
  ) {
    throw new Error("bad #CHROM line");
  }
  if (header.length !== 10) throw new Error("expected exactly one sample");
  const order = [...contigs.keys()];
  const records: Record[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = line.split("\t");
    if (cells.length !== 10) throw new Error(`wrong column count: ${line}`);
    const [
      chrom = "",
      pos,
      id = "",
      ref = "",
      alt = "",
      qual,
      filter,
      infoText = "",
      fmt,
      gt = "",
    ] = cells;
    const position = Number(pos);
    const length = contigs.get(chrom);
    if (length === undefined) throw new Error(`undeclared contig ${chrom}`);
    if (!(Number.isInteger(position) && position >= 1 && position <= length)) {
      throw new Error(`position out of range: ${line}`);
    }
    if (!/^rs\d+$/.test(id)) throw new Error(`bad ID ${id}`);
    if (!/^[ACGT]$/.test(ref) || !/^[ACGT]$/.test(alt) || ref === alt) {
      throw new Error(`bad alleles: ${line}`);
    }
    if (qual !== "." || filter !== "PASS") throw new Error(`bad QUAL/FILTER: ${line}`);
    for (const entry of infoText.split(";")) {
      const [key = "", value] = entry.split("=");
      const spec = info.get(key);
      if (!spec) throw new Error(`undeclared INFO ${key}`);
      if ((spec.type === "Flag") !== (value === undefined))
        throw new Error(`bad flag ${key}`);
      if (spec.type === "Float" && !Number.isFinite(Number(value))) {
        throw new Error(`bad float ${key}=${value}`);
      }
    }
    if (fmt !== "GT" || !format.has("GT")) throw new Error(`bad FORMAT: ${line}`);
    if (!/^(\.\/\.|[01]\/[01])$/.test(gt)) throw new Error(`bad GT ${gt}`);
    const previous = records.at(-1);
    if (previous) {
      const before = order.indexOf(previous.chrom) - order.indexOf(chrom);
      if (before > 0 || (before === 0 && previous.pos >= position)) {
        throw new Error(`not sorted at ${chrom}:${position}`);
      }
    }
    records.push({ chrom, pos: position, id, gt });
  }
  return { meta, sample: header[9], records };
};

describe("renderVcf", () => {
  const variants = catalog();
  const calls = callsFor(REF, variants);
  const text = renderVcf(REF, calls);

  test("is a valid single-sample VCF 4.2 with every catalog site", () => {
    const vcf = readVcf(text);
    expect(vcf.sample).toBe("SYNTHETIC_080b069b");
    expect(vcf.records.length).toBe(92);
    expect(new Set(vcf.records.map((r) => r.id))).toEqual(
      new Set(variants.map((v) => v.rsid)),
    );
    expect(vcf.records.filter((r) => r.gt === "./.").map((r) => r.id)).toEqual([
      "rs1801280",
    ]);
    expect(
      Object.fromEntries(
        [...Map.groupBy(vcf.records, (r) => r.gt)].map(([gt, list]) => [gt, list.length]),
      ),
    ).toEqual({
      "0/0": 66,
      "0/1": 16,
      "1/1": 9,
      "./.": 1,
    });
  });

  test("says it is synthetic and GRCh38", () => {
    const vcf = readVcf(text);
    expect(vcf.meta.slice(0, 3)).toEqual([
      "##fileformat=VCFv4.2",
      "##source=TwinLLM-synthetic",
      "##reference=GRCh38",
    ]);
    expect(vcf.meta[3]).toStartWith('##TwinLLM_note="SYNTHETIC - not a real person.');
    expect(vcf.meta.filter((line) => line.startsWith("##contig="))).toHaveLength(
      GRCH38_CONTIGS.length,
    );
  });

  test("writes the records it was given", () => {
    const record = text.split("\n").find((line) => line.includes("\trs4244285\t"));
    expect(record).toBe(
      "chr10\t94781859\trs4244285\tG\tA\t.\tPASS\tGENE=CYP2C19;POP_AF=0.1679;SYNTHETIC\tGT\t0/1",
    );
  });

  test("is byte-stable: a change here changes every synthetic genome", () => {
    expect(new Bun.CryptoHasher("sha256").update(text).digest("hex")).toBe(
      "1ac99bd1a6b5729bf8161c927be721dbdda515b318850c929b58c33fbdeb741e",
    );
  });

  test("the reader rejects what a VCF parser would reject", () => {
    const swap = (from: string, to: string) => () => readVcf(text.replace(from, to));
    expect(swap("##fileformat=VCFv4.2", "##fileformat=VCFv4.1")).toThrow("fileformat");
    expect(swap("\tGT\t0/1", "\tGT\t0|2")).toThrow("bad GT");
    expect(swap("GENE=CYP2C19", "GENES=CYP2C19")).toThrow("undeclared INFO");
    expect(swap("chr10\t94781859", "chr23\t94781859")).toThrow("undeclared contig");
    expect(swap("chr10\t94781859", "chr10\t1")).toThrow("not sorted");
    expect(swap("not a real person", "not a real persón")).toThrow("non-ASCII");
  });

  test("sample names keep only the first block of the ref", () => {
    expect(sampleName(REF)).toBe("SYNTHETIC_080b069b");
  });
});
