import { ABSTRACT_SNIPPET_CHARS, EUTILS_BASE } from "./constants";

/**
 * Pure helpers for PubMed through NCBI E-utilities: esearch (which PMIDs
 * match), esummary (title, journal, date, DOI) and efetch (the abstract, for a
 * short snippet). No network here; `tools.ts` sends through the ledgered fetch.
 */

export type EutilsIdentity = Readonly<{
  /** NCBI's `tool` parameter: one word naming the software. */
  tool: string;
  /** NCBI's `email` parameter, sent only when the operator set one. */
  email: string | null;
}>;

export type PubmedArticle = Readonly<{
  pmid: string;
  title: string;
  journal: string;
  year: string | null;
  doi: string | null;
  abstractSnippet: string | null;
  url: string;
}>;

export type LiveCitation = Readonly<{
  source: "PubMed" | "Ensembl";
  id: string;
  title: string;
  url: string;
}>;

const withIdentity = (
  params: Record<string, string>,
  identity: EutilsIdentity,
): URLSearchParams => {
  const search = new URLSearchParams({ ...params, tool: identity.tool });
  if (identity.email !== null) search.set("email", identity.email);
  return search;
};

export const esearchUrl = (
  query: string,
  limit: number,
  identity: EutilsIdentity,
): string =>
  `${EUTILS_BASE}/esearch.fcgi?${withIdentity(
    {
      db: "pubmed",
      term: query,
      retmax: String(limit),
      retmode: "json",
      sort: "relevance",
    },
    identity,
  ).toString()}`;

export const esummaryUrl = (pmids: readonly string[], identity: EutilsIdentity): string =>
  `${EUTILS_BASE}/esummary.fcgi?${withIdentity(
    { db: "pubmed", id: pmids.join(","), retmode: "json" },
    identity,
  ).toString()}`;

export const efetchUrl = (pmids: readonly string[], identity: EutilsIdentity): string =>
  `${EUTILS_BASE}/efetch.fcgi?${withIdentity(
    { db: "pubmed", id: pmids.join(","), rettype: "abstract", retmode: "xml" },
    identity,
  ).toString()}`;

export const pubmedArticleUrl = (pmid: string): string =>
  `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** PMIDs from an esearch JSON body, in NCBI's order; throws on a malformed body. */
export const parseEsearchPmids = (body: string): readonly string[] => {
  const parsed: unknown = JSON.parse(body);
  const result = isRecord(parsed) ? parsed.esearchresult : undefined;
  const ids = isRecord(result) ? result.idlist : undefined;
  if (!Array.isArray(ids)) throw new Error("PUBMED_ESEARCH_MALFORMED");
  return ids.filter((id): id is string => typeof id === "string" && /^\d{1,9}$/.test(id));
};

const yearOf = (record: Record<string, unknown>): string | null => {
  const date = text(record.pubdate) ?? text(record.sortpubdate) ?? "";
  return /^(\d{4})/.exec(date)?.[1] ?? null;
};

const doiOf = (record: Record<string, unknown>): string | null => {
  const ids = Array.isArray(record.articleids) ? record.articleids : [];
  const doi = ids.find((id) => isRecord(id) && id.idtype === "doi");
  return isRecord(doi) ? text(doi.value) : null;
};

/**
 * One entry per PMID that esummary describes, in the order asked for. An id
 * esummary leaves out or marks with an error is dropped.
 */
export const parseEsummary = (
  body: string,
  pmids: readonly string[],
): readonly Omit<PubmedArticle, "abstractSnippet">[] => {
  const parsed: unknown = JSON.parse(body);
  const result = isRecord(parsed) ? parsed.result : undefined;
  if (!isRecord(result)) throw new Error("PUBMED_ESUMMARY_MALFORMED");
  return pmids.flatMap((pmid) => {
    const record = result[pmid];
    if (!isRecord(record) || record.error !== undefined) return [];
    const title = text(record.title);
    if (title === null) return [];
    return [
      {
        pmid,
        title,
        journal: text(record.fulljournalname) ?? text(record.source) ?? "",
        year: yearOf(record),
        doi: doiOf(record),
        url: pubmedArticleUrl(pmid),
      },
    ];
  });
};

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });

/** The text of an XML fragment: tags dropped, entities decoded, spaces folded. */
const plainText = (xml: string): string =>
  decodeEntities(xml.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/** Cuts at a word boundary near `max` characters and marks the cut. */
export const snippet = (value: string, max: number = ABSTRACT_SNIPPET_CHARS): string => {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()} …`;
};

/** PMID to abstract snippet from an efetch XML body. Articles without an abstract are left out. */
export const parseAbstracts = (xml: string): ReadonlyMap<string, string> =>
  new Map(
    xml
      .split(/<PubmedArticle[\s>]/)
      .slice(1)
      .flatMap((article) => {
        const pmid = /<PMID[^>]*>(\d{1,9})<\/PMID>/.exec(article)?.[1];
        const parts = [
          ...article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g),
        ]
          .map((match) => plainText(match[1] ?? ""))
          .filter((part) => part !== "");
        return pmid === undefined || parts.length === 0
          ? []
          : [[pmid, snippet(parts.join(" "))] as const];
      }),
  );

export const pubmedCitation = (article: PubmedArticle): LiveCitation => ({
  source: "PubMed",
  id: `PMID:${article.pmid}`,
  title: article.title,
  url: article.url,
});
