import { MAX_FILE_BYTES } from "./limits";
import { parseAppleHealth } from "./parse-apple-health";
import { parseFhir } from "./parse-fhir";
import { parseLabCsv } from "./parse-lab-csv";
import { parseResearchTable } from "./parse-research-table";
import { parseVcf, type VcfOptions } from "./parse-vcf";
import { parseWearableExport } from "./parse-wearable-export";
import { decodeUtf8 } from "./text-file";
import type { ImportKind, ParsedImport } from "./types";

/**
 * One uploaded file to drafts, by the format the person picked. Pure; stores
 * nothing. Apple Health and wearable exports may be zips and are decoded by
 * their own parsers; the file name helps a wearable export find its layout.
 * A VCF may be gzip and is read as a stream; `assumeBuild` is the owner's
 * GENOME_ASSUME_BUILD, used only when the VCF names no build.
 */
export const parseImport = (
  kind: ImportKind,
  bytes: Uint8Array,
  fileName: string = "",
  options: VcfOptions = { assumeBuild: null },
): ParsedImport => {
  if (bytes.byteLength === 0) {
    return { ok: false, refusal: { code: "empty", message: "The file is empty." } };
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      refusal: { code: "too-large", message: "The file is larger than 50 MB." },
    };
  }
  if (kind === "apple-health") return parseAppleHealth(bytes);
  if (kind === "wearable") return parseWearableExport(fileName, bytes);
  if (kind === "vcf") return parseVcf(bytes, options);
  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      ok: false,
      refusal: { code: "not-utf8", message: "The file is not UTF-8 text." },
    };
  }
  switch (kind) {
    case "fhir":
      return parseFhir(text);
    case "lab-csv":
      return parseLabCsv(text);
    case "table":
      return parseResearchTable(text);
  }
};
