import Link from "next/link";

import { formatDate, formatNumber } from "@/infrastructure/format-measure";
import { buttonClassName } from "@/infrastructure/ui-kit/button";

import {
  defaultDir,
  type SubjectPage,
  type SubjectQuery,
  type SubjectSort,
  subjectQueryString,
} from "./subject-table";
import { COHORT_SUBJECTS } from "./data-paths";

/**
 * The cohort's subjects as a server-rendered table. Search is a GET form and
 * sorting and paging are links, so the table works without JavaScript and a
 * sorted, filtered view can be shared as a URL. The page arrives already
 * searched, sorted and cut by the database. Only subject_refs and counts
 * are listed; opening a subject is its own audited read.
 */

const COLUMNS: readonly (readonly [SubjectSort, string, "left" | "right"])[] = [
  ["ref", "Subject", "left"],
  ["observations", "Observations", "right"],
  ["codes", "Codes", "right"],
  ["first", "First", "left"],
  ["last", "Last", "left"],
];

export const subjectHref = (ref: string): string =>
  `${COHORT_SUBJECTS}/${encodeURIComponent(ref)}`;

const SortHeader = ({
  cohortId,
  query,
  sort,
  label,
  align,
}: {
  readonly cohortId: string;
  readonly query: SubjectQuery;
  readonly sort: SubjectSort;
  readonly label: string;
  readonly align: "left" | "right";
}) => {
  const active = query.sort === sort;
  const nextDir = active ? (query.dir === "asc" ? "desc" : "asc") : defaultDir(sort);
  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : undefined}
      className={`text-eyebrow px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <Link
        href={`${COHORT_SUBJECTS}${subjectQueryString(cohortId, { q: query.q, sort, dir: nextDir })}`}
        className="hover:text-foreground rounded-sm"
      >
        {label}
        {active && <span aria-hidden>{query.dir === "asc" ? " ↑" : " ↓"}</span>}
      </Link>
    </th>
  );
};

export const SubjectsTable = ({
  cohortId,
  page,
  query,
}: {
  readonly cohortId: string;
  readonly page: SubjectPage;
  readonly query: SubjectQuery;
}) => {
  const pageLink = (target: number) =>
    `${COHORT_SUBJECTS}${subjectQueryString(cohortId, { ...query, page: target })}`;

  return (
    <section className="mt-6">
      <form
        method="get"
        action={COHORT_SUBJECTS}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="cohort" value={cohortId} />
        {query.sort !== "observations" && (
          <input type="hidden" name="sort" value={query.sort} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor="subject-search"
            className="text-muted-foreground text-xs font-medium"
          >
            subject_ref starts with
          </label>
          <input
            id="subject-search"
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={64}
            className="border-input bg-background text-foreground w-full rounded-md border px-2 py-1.5 font-mono text-sm"
          />
        </div>
        <button type="submit" className={buttonClassName()}>
          Search
        </button>
      </form>

      <p className="text-muted-foreground mt-3 text-sm" aria-live="polite">
        {formatNumber(page.matching, 0)} of {formatNumber(page.total, 0)} subjects
        {query.q ? ` start with “${query.q}”` : ""}. Open one to see its measurements over
        time.
      </p>

      <div className="surface relative mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Subjects in {cohortId} with their numeric observation counts
          </caption>
          <thead>
            <tr className="border-border border-b">
              {COLUMNS.map(([sort, label, align]) => (
                <SortHeader
                  key={sort}
                  cohortId={cohortId}
                  query={query}
                  sort={sort}
                  label={label}
                  align={align}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr
                key={row.ref}
                className="border-border hover:bg-muted/50 border-b last:border-b-0"
              >
                <td className="max-w-[9rem] px-3 py-2 sm:max-w-none">
                  <Link
                    href={subjectHref(row.ref)}
                    title={row.ref}
                    className="block truncate font-mono text-xs underline-offset-2 hover:underline"
                  >
                    {row.ref}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                  {formatNumber(row.observations, 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                  {formatNumber(row.codes, 0)}
                </td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {formatDate(row.firstDay)}
                </td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {formatDate(row.lastDay)}
                </td>
              </tr>
            ))}
            {page.rows.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="text-muted-foreground px-3 py-6 text-sm"
                >
                  No subject_ref starts with that text.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2">
        {page.page > 1 ? (
          <Link
            href={pageLink(page.page - 1)}
            className={buttonClassName({ size: "sm" })}
          >
            Previous
          </Link>
        ) : (
          <span
            className={buttonClassName({ size: "sm", className: "opacity-50" })}
            aria-disabled
          >
            Previous
          </span>
        )}
        <span className="text-muted-foreground font-mono text-xs">
          Page {page.page} of {page.pages}
        </span>
        {page.page < page.pages ? (
          <Link
            href={pageLink(page.page + 1)}
            className={buttonClassName({ size: "sm" })}
          >
            Next
          </Link>
        ) : (
          <span
            className={buttonClassName({ size: "sm", className: "opacity-50" })}
            aria-disabled
          >
            Next
          </span>
        )}
      </nav>
    </section>
  );
};
