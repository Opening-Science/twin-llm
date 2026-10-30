import { Gunzip } from "fflate";

import { MAX_VARIANTS, MAX_VCF_TEXT_BYTES } from "./limits";
import type { ImportRefusal, ParsedImport, Unmapped, VariantDraft } from "./types";
import { buildNamesInLine, decideVcfBuild } from "./vcf-build";

/**
 * A single-sample VCF 4.x, plain or gzip (bgzip included), read as a stream:
 * gzip is inflated in 1 MB steps, the text decoded in steps and split into
 * lines, so neither the inflated file nor its text is ever held whole. The
 * caps (`MAX_VCF_TEXT_BYTES`, `MAX_VARIANTS`) stop the read as soon as they
 * are passed and refuse the file; nothing is cut.
 *
 * Only GRCh38 is read (`vcf-build.ts`). Per record only the chromosome,
 * position, ID, reference, alternate alleles, FILTER and the sample's GT are
 * kept; QUAL, INFO, the other FORMAT fields and the sample's name are not.
 * A record that cannot be read is reported with its line number and why,
 * never guessed at. Pure; stores nothing.
 */

export type VcfOptions = Readonly<{
  assumeBuild: "GRCh38" | null;
  /** The caps; `limits.ts` unless a test passes smaller ones. */
  maxTextBytes?: number;
  maxVariants?: number;
}>;

const FIXED_COLUMNS = ["#CHROM", "POS", "ID", "REF", "ALT", "QUAL", "FILTER", "INFO"];

const FILEFORMAT = /^##fileformat=VCFv(\d+)\.(\d+)$/;

const BASES = /^[ACGTN]+$/i;
const ALT_ALLELE = /^(?:[ACGTN]+|\*)$/i;
/** The gVCF placeholders for "any other allele"; dropped when they come last. */
const ANY_ALLELE = new Set(["<NON_REF>", "<*>"]);
const GENOTYPE = /^(?:\.|\d+)(?:[/|](?:\.|\d+))*$/;
/** Positions are stored in a 32-bit column; GRCh38's longest chromosome is 249 Mb. */
const MAX_POSITION = 2_147_483_647;

export type GenotypeClass = "hom-ref" | "het" | "hom-alt" | "no-call";

/**
 * A GT as one of four counts for the review. Any missing allele makes it a
 * no-call; a haploid alternate (`1`) counts as homozygous alternate.
 */
export const genotypeClass = (genotype: string | null): GenotypeClass => {
  if (genotype === null) return "no-call";
  const alleles = genotype.split(/[/|]/);
  if (alleles.includes(".")) return "no-call";
  if (alleles.every((allele) => allele === "0")) return "hom-ref";
  return new Set(alleles).size > 1 ? "het" : "hom-alt";
};

export type RecordResult =
  | Readonly<{ ok: true; variant: VariantDraft }>
  | Readonly<{ ok: false; code: string; reason: string }>;

const skip = (code: string, reason: string): RecordResult => ({
  ok: false,
  code,
  reason,
});

const orNull = (cell: string): string | null => (cell === "." ? null : cell);

/** One data line of a single-sample VCF (ten tab-separated columns). Pure. */
export const parseVcfRecord = (line: string): RecordResult => {
  const cells = line.split("\t");
  if (cells.length !== 10) {
    return skip("wrong-columns", `has ${cells.length} columns; a one-sample VCF has 10`);
  }
  const [chrom, pos, id, ref, alt, , filter, , format, sample] = cells as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (chrom === "" || /\s/.test(chrom)) return skip("bad-chrom", "has no chromosome");
  if (!/^[1-9]\d*$/.test(pos) || Number(pos) > MAX_POSITION) {
    return skip("bad-position", "has a position that is not a whole number above 0");
  }
  if (!BASES.test(ref)) {
    return skip("bad-ref", "has a reference allele that is not A, C, G, T or N");
  }
  const listed = alt.split(",");
  const alleles =
    listed.length > 1 && ANY_ALLELE.has(listed.at(-1)!) ? listed.slice(0, -1) : listed;
  if (alt === "." || alleles.every((allele) => ANY_ALLELE.has(allele))) {
    return skip("reference-only", "is a reference-only record with no alternate allele");
  }
  if (!alleles.every((allele) => ALT_ALLELE.test(allele))) {
    return skip(
      "symbolic-allele",
      "has a symbolic or breakend allele (such as <DEL>), which this import does not read",
    );
  }
  const gtAt = format.split(":").indexOf("GT");
  if (gtAt === -1) return skip("no-genotype", "has no GT field");
  const genotype = sample.split(":")[gtAt] ?? ".";
  if (!GENOTYPE.test(genotype)) {
    return skip("bad-genotype", "has a GT that is not a genotype");
  }
  const indexes = genotype.split(/[/|]/).filter((allele) => allele !== ".");
  if (indexes.some((allele) => Number(allele) > alleles.length)) {
    return skip("bad-genotype", "has a GT that names an allele the record does not list");
  }
  return {
    ok: true,
    variant: {
      chrom,
      pos: Number(pos),
      variantId: orNull(id),
      ref,
      alt: alleles.join(","),
      genotype: indexes.length === 0 ? null : genotype,
      filter: orNull(filter),
    },
  };
};

const refusal = (code: string, message: string): ParsedImport => ({
  ok: false,
  refusal: { code, message },
});

const NOTES = [
  "Kept per record: chromosome, position, ID, reference and alternate alleles, FILTER and the sample's genotype (GT). QUAL, INFO, the other FORMAT fields and the sample's name are not stored.",
  "A genome file is read only by models on this machine; no hosted model ever receives it.",
];

type Tally = Map<string, { where: string; code: string; reason: string; count: number }>;

type Scan = Readonly<{
  /** False once the scan has stopped: refused, or over a cap. */
  push: (text: string) => boolean;
  finish: () => ParsedImport;
}>;

const createVcfScan = (options: VcfOptions): Scan => {
  const maxVariants = options.maxVariants ?? MAX_VARIANTS;
  const variants: VariantDraft[] = [];
  const tally: Tally = new Map();
  const buildNames: string[] = [];
  let pending = "";
  let lineNumber = 0;
  let version: string | null = null;
  let build: ReturnType<typeof decideVcfBuild> | null = null;
  let stopped: ImportRefusal | null = null;

  const stop = (code: string, message: string) => {
    stopped = { code, message };
  };

  const report = (code: string, reason: string) => {
    const known = tally.get(code);
    tally.set(code, {
      where: known?.where ?? `line ${lineNumber}`,
      code,
      reason: known?.reason ?? reason,
      count: (known?.count ?? 0) + 1,
    });
  };

  const header = (line: string) => {
    const columns = line.split("\t");
    if (FIXED_COLUMNS.some((name, index) => columns[index] !== name)) {
      stop("not-vcf", "The #CHROM line does not have the VCF columns.");
      return;
    }
    const samples = Math.max(0, columns.length - 9);
    if (samples === 0) {
      stop("no-sample", "This VCF has no sample column, so it holds no genotypes.");
      return;
    }
    if (samples > 1) {
      stop(
        "several-samples",
        `This VCF holds ${samples} samples. Import a VCF with one person's sample.`,
      );
      return;
    }
    build = decideVcfBuild(buildNames, options.assumeBuild);
    if (!build.ok) stop(build.refusal.code, build.refusal.message);
  };

  const readLine = (raw: string) => {
    lineNumber += 1;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (lineNumber === 1) {
      const format = FILEFORMAT.exec(line);
      if (format === null) {
        stop("not-vcf", "This is not a VCF: the first line is not ##fileformat=VCFv4.x.");
      } else if (format[1] !== "4") {
        stop(
          "vcf-version",
          `Only VCF 4.x is imported; this file is VCF ${format[1]}.${format[2]}.`,
        );
      } else {
        version = `${format[1]}.${format[2]}`;
      }
      return;
    }
    if (build === null) {
      if (line.startsWith("##")) {
        buildNames.push(...buildNamesInLine(line));
      } else if (line.startsWith("#CHROM")) {
        header(line);
      } else if (line !== "") {
        stop("not-vcf", "The file has records before its #CHROM header line.");
      }
      return;
    }
    if (line === "") return;
    const record = parseVcfRecord(line);
    if (!record.ok) {
      report(record.code, record.reason);
      return;
    }
    if (variants.length >= maxVariants) {
      stop(
        "too-many-variants",
        `The VCF has more than ${maxVariants} variant records; the limit is ${maxVariants}.`,
      );
      return;
    }
    variants.push(record.variant);
  };

  return {
    push: (text) => {
      if (stopped !== null) return false;
      const lines = (pending + text).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        readLine(line);
        if (stopped !== null) return false;
      }
      return true;
    },
    finish: () => {
      if (stopped === null && pending !== "") {
        readLine(pending);
        pending = "";
      }
      const refused: ImportRefusal | null = stopped;
      if (refused !== null) return refusal(refused.code, refused.message);
      const decided = build as ReturnType<typeof decideVcfBuild> | null;
      if (version === null || decided === null || !decided.ok) {
        return refusal("not-vcf", "This VCF has no #CHROM header line.");
      }
      const unmapped: Unmapped[] = [...tally.values()];
      return {
        ok: true,
        kind: "vcf",
        variants,
        build: decided.build,
        buildSource: decided.source,
        unmapped,
        notes: [
          decided.source === "file"
            ? `Read as VCF ${version} on GRCh38, as the file names it.`
            : `Read as VCF ${version} on GRCh38, as GENOME_ASSUME_BUILD states; the file names no build.`,
          ...NOTES,
        ],
      };
    },
  };
};

/** Bytes per decode step for a plain file. */
const CHUNK = 1 << 20;

/**
 * Compressed bytes per inflate step. Deflate expands at most about 1,000
 * times, so one step never inflates to much more than 64 MB at once, even
 * for a file built to expand.
 */
const GZIP_STEP = 1 << 16;

const isGzip = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b;

const tooLong = (maxTextBytes: number): ParsedImport =>
  refusal(
    "too-large",
    `The VCF's text is longer than ${maxTextBytes / 1_000_000} MB, the limit for one import.`,
  );

/**
 * Feeds text bytes to the scan through a streaming UTF-8 decoder, counting
 * them against the text cap. Returns a refusal once reading must stop for a
 * reason the scan does not know (not UTF-8, too long); null otherwise.
 */
const createTextSink = (scan: Scan, maxTextBytes: number) => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let textBytes = 0;
  let failure: ParsedImport | null = null;
  let open = true;
  const feed = (decode: () => string) => {
    if (!open) return;
    try {
      open = scan.push(decode());
    } catch {
      failure = refusal("not-utf8", "The file is not UTF-8 text.");
      open = false;
    }
  };
  return {
    chunk: (bytes: Uint8Array) => {
      if (!open) return;
      textBytes += bytes.byteLength;
      if (textBytes > maxTextBytes) {
        failure = tooLong(maxTextBytes);
        open = false;
        return;
      }
      feed(() => decoder.decode(bytes, { stream: true }));
    },
    end: () => feed(() => decoder.decode()),
    open: () => open,
    failure: (): ParsedImport | null => failure,
  };
};

const GZIP_UNREADABLE = refusal("gzip-unreadable", "The gzip file could not be read.");

export const parseVcf = (bytes: Uint8Array, options: VcfOptions): ParsedImport => {
  const scan = createVcfScan(options);
  const sink = createTextSink(scan, options.maxTextBytes ?? MAX_VCF_TEXT_BYTES);
  if (isGzip(bytes)) {
    let inflated = 0;
    try {
      const gunzip = new Gunzip((chunk) => {
        inflated += chunk.byteLength;
        sink.chunk(chunk);
      });
      for (let start = 0; start < bytes.byteLength && sink.open(); start += GZIP_STEP) {
        gunzip.push(
          bytes.subarray(start, start + GZIP_STEP),
          start + GZIP_STEP >= bytes.byteLength,
        );
      }
    } catch {
      return GZIP_UNREADABLE;
    }
    // A gzip header with no data behind it inflates to nothing without an error.
    if (inflated === 0) return GZIP_UNREADABLE;
  } else {
    for (let start = 0; start < bytes.byteLength && sink.open(); start += CHUNK) {
      sink.chunk(bytes.subarray(start, start + CHUNK));
    }
  }
  sink.end();
  return sink.failure() ?? scan.finish();
};
