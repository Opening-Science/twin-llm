/**
 * Search, sort and paging for the subjects table, from URL parameters.
 *
 * The table is a server render driven by `?q=&sort=&dir=&page=`, so a link
 * to a sorted, filtered page works without JavaScript and survives a reload.
 * Pure: the page reads the cohort's per-subject counts once and these
 * functions cut them. A subject with no numeric rows has no first or last
 * day; those sort last in either direction rather than as day zero.
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

const sortValue = (row: SubjectSummary, sort: SubjectSort): string | number | null => {
  if (sort === "observations") return row.observations;
  if (sort === "codes") return row.codes;
  if (sort === "first") return row.firstDay;
  if (sort === "last") return row.lastDay;
  return row.ref;
};

const compare = (a: string | number, b: string | number): number =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b));

export const sortSubjects = (
  rows: readonly SubjectSummary[],
  sort: SubjectSort,
  dir: SortDir,
): readonly SubjectSummary[] =>
  [...rows].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null || right === null) {
      if (left === right) return a.ref.localeCompare(b.ref);
      return left === null ? 1 : -1;
    }
    const order = compare(left, right) * (dir === "asc" ? 1 : -1);
    return order || a.ref.localeCompare(b.ref);
  });

export type SubjectPage = Readonly<{
  rows: readonly SubjectSummary[];
  matching: number;
  page: number;
  pages: number;
}>;

/** Filter by ref substring (case-insensitive), sort, then cut one page. */
export const pageSubjects = (
  rows: readonly SubjectSummary[],
  query: SubjectQuery,
  perPage: number = SUBJECTS_PER_PAGE,
): SubjectPage => {
  const needle = query.q.toLowerCase();
  const matching = needle
    ? rows.filter((row) => row.ref.toLowerCase().includes(needle))
    : rows;
  const sorted = sortSubjects(matching, query.sort, query.dir);
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const page = Math.min(query.page, pages);
  return {
    rows: sorted.slice((page - 1) * perPage, page * perPage),
    matching: sorted.length,
    page,
    pages,
  };
};

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
