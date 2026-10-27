/**
 * Search, sort and paging for the subjects table, from URL parameters.
 *
 * The table is a server render driven by `?q=&sort=&dir=&page=`, so a link
 * to a sorted, filtered page works without JavaScript and survives a reload.
 * Pure: these parse the URL and work out the window; the database does the
 * search (a subject_ref prefix), the sort and the LIMIT/OFFSET
 * (`subject-page-queries.ts`). A subject with no numeric rows has no first or
 * last day; those sort last in either direction rather than as day zero.
 */

export type SubjectSummary = Readonly<{
  ref: string;
  observations: number;
  codes: number;
  firstDay: string | null;
  lastDay: string | null;
}>;

export const SUBJECT_SORTS = ["ref", "observations", "codes", "first", "last"] as const;
export type SubjectSort = (typeof SUBJECT_SORTS)[number];
export type SortDir = "asc" | "desc";

export type SubjectQuery = Readonly<{
  q: string;
  sort: SubjectSort;
  dir: SortDir;
  page: number;
}>;

export const SUBJECTS_PER_PAGE = 25;

type Params = Readonly<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const isSort = (value: string | undefined): value is SubjectSort =>
  (SUBJECT_SORTS as readonly string[]).includes(value ?? "");

/** Counts read best largest first; refs and days read best in order. */
export const defaultDir = (sort: SubjectSort): SortDir =>
  sort === "observations" || sort === "codes" ? "desc" : "asc";

export const parseSubjectQuery = (params: Params): SubjectQuery => {
  const rawSort = single(params.sort);
  const sort: SubjectSort = isSort(rawSort) ? rawSort : "observations";
  const rawDir = single(params.dir);
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : defaultDir(sort);
  const page = Number(single(params.page));
  return {
    q: (single(params.q) ?? "").trim().slice(0, 64),
    sort,
    dir,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
};

export type SubjectPage = Readonly<{
  rows: readonly SubjectSummary[];
  /** Subjects in the cohort whose ref starts with the search. */
  matching: number;
  /** Subjects in the cohort. */
  total: number;
  page: number;
  pages: number;
}>;

export type PageWindow = Readonly<{
  page: number;
  pages: number;
  skip: number;
  take: number;
}>;

/** The page to read for `matching` rows; a page past the end is held at the last one. */
export const pageWindow = (
  requested: number,
  matching: number,
  perPage: number = SUBJECTS_PER_PAGE,
): PageWindow => {
  const pages = Math.max(1, Math.ceil(matching / perPage));
  const page = Math.min(Math.max(1, requested), pages);
  return { page, pages, skip: (page - 1) * perPage, take: perPage };
};

/**
 * The search with `\\`, `%` and `_` escaped, so it matches itself in a LIKE
 * prefix. Prisma's `startsWith` puts the text into LIKE as it is.
 */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, "\\$&");

/** The query string for a table link, leaving out defaults. */
export const subjectQueryString = (
  cohortId: string,
  query: Partial<SubjectQuery>,
): string => {
  const params = new URLSearchParams({ cohort: cohortId });
  if (query.q) params.set("q", query.q);
  if (query.sort && query.sort !== "observations") params.set("sort", query.sort);
  if (query.sort && query.dir && query.dir !== defaultDir(query.sort))
    params.set("dir", query.dir);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  return `?${params}`;
};
