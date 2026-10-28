/**
 * Pure helpers for the two NLM services the literature fetch uses: E-utilities
 * esearch on the PMC database (which articles match), and the PMC Article
 * Datasets bucket (each article version's metadata, licence and plain text).
 * No network here; scripts/literature/fetch.ts does the I/O.
 */
import { EUTILS_BASE, EUTILS_TOOL, PMC_S3_BASE } from "./constants";

export type EsearchParams = Readonly<{
  term: string;
  retmax: number;
  email?: string;
}>;

export const esearchUrl = ({ term, retmax, email }: EsearchParams): string => {
  const params = new URLSearchParams({
    db: "pmc",
    term,
    retmax: String(retmax),
    retmode: "json",
    tool: EUTILS_TOOL,
  });
  if (email) params.set("email", email);
  return `${EUTILS_BASE}/esearch.fcgi?${params.toString()}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** PMCIDs (with the PMC prefix) from an esearch JSON body, in result order. */
export const parseEsearchIds = (body: string): string[] => {
  const parsed: unknown = JSON.parse(body);
  const result = isRecord(parsed) ? parsed.esearchresult : undefined;
  const ids = isRecord(result) ? result.idlist : undefined;
  if (!Array.isArray(ids)) throw new Error("LITERATURE_ESEARCH_MALFORMED");
  return ids
    .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
    .map((id) => `PMC${id}`);
};

/** S3 ListObjectsV2 URL for every metadata version of one PMCID. */
export const metadataListUrl = (pmcid: string): string =>
  `${PMC_S3_BASE}/?list-type=2&prefix=${encodeURIComponent(`metadata/${pmcid}.`)}`;

/**
 * The metadata key of the newest version in a ListObjectsV2 XML body, e.g.
 * `metadata/PMC123.2.json`, or null when the article is not in the dataset.
 */
export const latestMetadataKey = (xml: string, pmcid: string): string | null => {
  const pattern = new RegExp(`<Key>(metadata/${pmcid}\\.(\\d+)\\.json)</Key>`, "g");
  const versions = [...xml.matchAll(pattern)].map((match) => ({
    key: match[1] ?? "",
    version: Number(match[2]),
  }));
  const newest = versions.reduce<{ key: string; version: number } | null>(
    (best, entry) => (best === null || entry.version > best.version ? entry : best),
    null,
  );
  return newest?.key ?? null;
};

export const objectUrl = (key: string): string => `${PMC_S3_BASE}/${key}`;

/** `s3://pmc-oa-opendata/<key>?md5=…` to its public https URL. */
export const s3ToHttps = (s3Url: string): string => {
  const match = s3Url.match(/^s3:\/\/pmc-oa-opendata\/(.+)$/);
  if (!match?.[1]) throw new Error("LITERATURE_S3_URL_UNEXPECTED");
  return `${PMC_S3_BASE}/${match[1]}`;
};

export type PmcMetadata = Readonly<{
  pmcid: string;
  version: number;
  pmid: number | null;
  doi: string | null;
  title: string;
  citation: string;
  isOpenAccess: boolean;
  isManuscript: boolean;
  isRetracted: boolean;
  licenceCode: string | null;
  textUrl: string | null;
}>;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** One article version's JSON metadata object from the PMC bucket. */
export const parsePmcMetadata = (body: string): PmcMetadata => {
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error("LITERATURE_METADATA_MALFORMED");
  const pmcid = stringOrNull(parsed.pmcid);
  const version = parsed.version;
  if (pmcid === null || typeof version !== "number") {
    throw new Error("LITERATURE_METADATA_MALFORMED");
  }
  const textUrl = stringOrNull(parsed.text_url);
  return {
    pmcid,
    version,
    pmid: typeof parsed.pmid === "number" ? parsed.pmid : null,
    doi: stringOrNull(parsed.doi),
    title: stringOrNull(parsed.title) ?? pmcid,
    citation: stringOrNull(parsed.citation) ?? "",
    isOpenAccess: parsed.is_pmc_openaccess === true,
    isManuscript: parsed.is_manuscript === true,
    isRetracted: parsed.is_retracted === true,
    licenceCode: stringOrNull(parsed.license_code),
    textUrl: textUrl === null ? null : s3ToHttps(textUrl),
  };
};

/** The article page on PMC, which a citation links to. */
export const pmcArticleUrl = (pmcid: string): string =>
  `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;
