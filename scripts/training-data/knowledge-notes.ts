/**
 * `knowledge_search` over the shipped OpenTwin biomarker catalogue
 * (`knowledge/opentwin/biomarker-catalogue.md`), for the anatomy track. The
 * real tool embeds the query and asks the database for the nearest chunks;
 * training runs without an embedding model, so this stand-in returns the
 * chunks of the same file, cut by the same chunker the ingest uses
 * (`chunkKnowledgeDocument`), that list a LOINC code named in the query, in
 * file order. The hits have the real tool's shape. Pure: the caller reads the
 * file.
 */
import {
  chunkKnowledgeDocument,
  parseKnowledgeFile,
} from "../../packages/knowledge/corpus";

/** The shape `knowledge_search` returns (`packages/knowledge/search.ts`). */
export type KnowledgeHit = Readonly<{
  id: string;
  title: string;
  file: string;
  sectionHeading: string;
  licence: string;
  passage: string;
}>;

export const CATALOGUE_FILE = "biomarker-catalogue.md";

/** Every chunk of the catalogue as a hit, in file order. */
export const catalogueChunks = (text: string): readonly KnowledgeHit[] => {
  const document = parseKnowledgeFile(CATALOGUE_FILE, text);
  return chunkKnowledgeDocument(document).map((chunk) => ({
    id: document.id,
    title: document.title,
    file: document.file,
    sectionHeading: chunk.sectionHeading,
    licence: document.licence,
    passage: chunk.text,
  }));
};

const LOINC_IN_QUERY = /\b\d{1,7}-\d\b/g;

/** Whether a passage names this LOINC code (not one that only starts with it). */
export const namesCode = (passage: string, code: string): boolean =>
  new RegExp(`LOINC ${code.replace("-", "\\-")}(?![0-9-])`).test(passage);

/** The chunks naming a LOINC code from the query, at most `k`; none when the query names no code. */
export const searchCatalogue = (
  chunks: readonly KnowledgeHit[],
  input: Readonly<{ query: string; k: number }>,
): KnowledgeHit[] => {
  const codes = input.query.match(LOINC_IN_QUERY) ?? [];
  return chunks
    .filter((chunk) => codes.some((code) => namesCode(chunk.passage, code)))
    .slice(0, input.k);
};

export type CatalogueLine = Readonly<{
  line: string;
  system: string;
  region: string;
  noSingleLocation: boolean;
}>;

/** The catalogue's line for a code in a passage: `... LOINC 4548-4, unit %, system metabolic, region ...`. */
export const catalogueLine = (passage: string, code: string): CatalogueLine | null => {
  const line = passage
    .split("\n")
    .find((candidate) => namesCode(candidate, code) && candidate.includes(", system "));
  const match = line?.match(/, system ([^,]+), region ([^.]+)\./);
  if (line === undefined || match === null || match === undefined) return null;
  return {
    line: line.replace(/^-\s*/, "").trim(),
    system: match[1] ?? "",
    region: match[2] ?? "",
    noSingleLocation: line.includes("No single body location"),
  };
};
