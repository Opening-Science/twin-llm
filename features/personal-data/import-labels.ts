import { EMPTY_VALUE, formatDate, formatNumber } from "@/infrastructure/format-measure";
import type { ImportKind, TableCell } from "@/packages/personal-data/types";

/**
 * Display text for the import screens. Pure, so the server and the browser
 * show the same thing. Dates come in as stored: `2024`, `2024-03`,
 * `2024-03-01` or a full ISO instant (shown as its UTC day).
 */

const YEAR = /^\d{4}$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const storedDateLabel = (value: string | null): string => {
  if (value === null) return EMPTY_VALUE;
  if (YEAR.test(value)) return value;
  const month = MONTH.exec(value);
  if (month) {
    const name = MONTH_NAMES[Number(month[2]) - 1];
    return name === undefined ? EMPTY_VALUE : `${name} ${month[1]}`;
  }
  const day = DAY_PREFIX.exec(value);
  return day ? formatDate(day[1]) : EMPTY_VALUE;
};

export const dateRangeLabel = (first: string | null, last: string | null): string => {
  if (first === null || last === null) return "no dates";
  const from = storedDateLabel(first);
  const to = storedDateLabel(last);
  return from === to ? from : `${from} to ${to}`;
};

export const countLabel = (count: number, one: string, many: string): string =>
  `${formatNumber(count, 0)} ${count === 1 ? one : many}`;

export const byteSizeLabel = (bytes: number): string =>
  bytes < 1_000_000
    ? `${formatNumber(bytes / 1000, 1)} kB`
    : `${formatNumber(bytes / 1_000_000, 1)} MB`;

/**
 * A preview cell exactly as it will be stored. Numbers are not rounded here:
 * the review must show the value Save writes, digit for digit.
 */
export const previewCellLabel = (cell: TableCell): string =>
  cell === null ? EMPTY_VALUE : String(cell);

/**
 * What a dataset holds, for its line in the list: a VCF's variant records
 * (its kind label already names GRCh38), else rows and the date range.
 */
export const datasetContentsLabel = (
  dataset: Readonly<{
    kind: ImportKind;
    rowCount: number;
    firstAt: string | null;
    lastAt: string | null;
  }>,
): string =>
  dataset.kind === "vcf"
    ? countLabel(dataset.rowCount, "variant record", "variant records")
    : `${countLabel(dataset.rowCount, "row", "rows")} · ${dateRangeLabel(dataset.firstAt, dataset.lastAt)}`;
