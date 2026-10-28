/**
 * A fetched article on disk and its shape in the guideline tables. Pure: the
 * fetch writes records with `toLiteratureRecord`, the ingest reads them back
 * with `parseLiteratureRecord` and chunks the text with
 * `chunkLiteratureArticle`.
 */
import {
  chunkGuidelineText,
  type GuidelineChunkDraft,
} from "@/packages/guidelines/chunk";
import type { StoredDocument } from "@/packages/guidelines/store";

import { isLiteratureLicence, type LiteratureLicence } from "./licence";
import { pmcArticleUrl, type PmcMetadata } from "./pmc";
import { isSpecialtyId, literatureSource, type SpecialtyId } from "./specialties";

/** `<pmcid>.<version>.json` next to `<pmcid>.<version>.txt`. */
export type LiteratureRecord = Readonly<{
  pmcid: string;
  version: number;
  specialty: SpecialtyId;
  title: string;
  citation: string;
  doi: string | null;
  pmid: number | null;
  licence: LiteratureLicence;
  licenceCode: string;
  url: string;
  textFile: string;
  query: string;
  fetchedAt: string;
}>;

export const articleBaseName = (pmcid: string, version: number): string =>
  `${pmcid}.${version}`;

export const toLiteratureRecord = (
  meta: PmcMetadata,
  extra: Readonly<{
    specialty: SpecialtyId;
    licence: LiteratureLicence;
    query: string;
    fetchedAt: string;
  }>,
): LiteratureRecord => ({
  pmcid: meta.pmcid,
  version: meta.version,
  specialty: extra.specialty,
  title: meta.title,
  citation: meta.citation,
  doi: meta.doi,
  pmid: meta.pmid,
  licence: extra.licence,
  licenceCode: meta.licenceCode ?? "",
  url: pmcArticleUrl(meta.pmcid),
  textFile: `${articleBaseName(meta.pmcid, meta.version)}.txt`,
  query: extra.query,
  fetchedAt: extra.fetchedAt,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads a record file back; refuses one whose licence or specialty is unknown. */
export const parseLiteratureRecord = (body: string): LiteratureRecord => {
  const parsed: unknown = JSON.parse(body);
  if (!isObject(parsed)) throw new Error("LITERATURE_RECORD_MALFORMED");
  const { pmcid, version, specialty, licence, textFile } = parsed;
  if (
    typeof pmcid !== "string" ||
    !/^PMC\d+$/.test(pmcid) ||
    typeof version !== "number" ||
    typeof specialty !== "string" ||
    !isSpecialtyId(specialty) ||
    typeof licence !== "string" ||
    !isLiteratureLicence(licence) ||
    typeof textFile !== "string"
  ) {
    throw new Error("LITERATURE_RECORD_MALFORMED");
  }
  const text = (key: string): string =>
    typeof parsed[key] === "string" ? (parsed[key] as string) : "";
  return {
    pmcid,
    version,
    specialty,
    licence,
    textFile,
    title: text("title") || pmcid,
    citation: text("citation"),
    doi: text("doi") || null,
    pmid: typeof parsed.pmid === "number" ? parsed.pmid : null,
    licenceCode: text("licenceCode"),
    url: text("url") || pmcArticleUrl(pmcid),
    query: text("query"),
    fetchedAt: text("fetchedAt"),
  };
};

const SEPARATOR = /^={10,}\s*$/;
const BACK_MATTER = /^(REFERENCES|References|Reference list|Bibliography)\s*$/;
const NUMBERED_HEADING = /^\d+(\.\d+)*\.?\s+\S.{0,100}$/;
const NAMED_HEADING =
  /^(Abstract|Background|Introduction|Methods|Materials and methods|Results|Discussion|Conclusions?|Summary)\s*$/i;

const isHeading = (line: string): boolean =>
  !line.endsWith(".") && (NUMBERED_HEADING.test(line) || NAMED_HEADING.test(line));

/**
 * The article body of a PMC plain-text file, with headings marked for the
 * guideline chunker. The PMC text starts with journal and article information
 * (author names, affiliations, contact emails) between `=====` lines; that
 * front matter is dropped, so nobody's address is embedded. Everything from
 * the reference list on is dropped too. A file whose front matter has no
 * closing separator gives an empty body, which the ingest skips.
 */
export const extractArticleBody = (text: string): string => {
  // PMC wraps the last separator in C1 control characters; drop those (not tabs).
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\p{Cc}/gu, (char) => (char === "\t" ? char : "")));
  const separators = lines.flatMap((line, index) =>
    SEPARATOR.test(line) ? [index] : [],
  );
  // Front matter whose end cannot be found is not guessed at: nothing is kept.
  if (separators.length > 0 && separators.length < 3) return "";
  const start = separators.length >= 3 ? (separators[2] ?? -1) + 1 : 0;
  const tail = lines.slice(start);
  const end = tail.findIndex((line) => BACK_MATTER.test(line.trim()));
  const body = end < 0 ? tail : tail.slice(0, end);
  return body
    .map((line) => {
      const trimmed = line.trim();
      return isHeading(trimmed) ? `# Section: ${trimmed}` : line;
    })
    .join("\n")
    .trim();
};

/** First four-digit year in a PMC citation ("Nutrients. 2024 Mar 2;…"), or 0. */
export const citationYear = (citation: string): number => {
  const match = citation.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
};

/** Journal abbreviation: the citation up to its first ". ". */
export const citationJournal = (citation: string): string => {
  const cut = citation.indexOf(". ");
  return (cut > 0 ? citation.slice(0, cut) : citation).trim() || "PMC";
};

/** Document id: one row per specialty and article version. */
export const literatureDocumentId = (record: LiteratureRecord): string =>
  `lit-${record.specialty}-${articleBaseName(record.pmcid, record.version)}`;

export const toLiteratureDocument = (record: LiteratureRecord): StoredDocument => ({
  id: literatureDocumentId(record),
  title: record.title,
  year: citationYear(record.citation),
  society: citationJournal(record.citation),
  doi: record.doi ?? "",
  url: record.url,
  licence: record.licence,
  ingestMode: "full_text",
  source: literatureSource(record.specialty),
});

/** Guideline chunker in marked mode, with the article title in front. */
export const chunkLiteratureArticle = (
  record: LiteratureRecord,
  text: string,
): GuidelineChunkDraft[] => {
  const body = extractArticleBody(text);
  const marked = /^#\s*Section:/i.test(body) ? body : `# Section: Article\n${body}`;
  return chunkGuidelineText(marked).map((draft) => ({
    ...draft,
    text: `${record.title} · ${draft.text}`,
  }));
};
