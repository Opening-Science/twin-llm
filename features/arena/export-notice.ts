import {
  describeFreeTextCheck,
  type FreeTextCheck,
} from "@/infrastructure/free-text-check";

/**
 * The notice a thread export shows before the file is made (#531). The
 * person asks for a check first (`?check=1`); the answer is one plain line
 * and whether they may go on. Only a confirmed request (`?confirm=1`) makes
 * the file. Kinds and counts only, never a value. Pure, so the page and the
 * route share it.
 */

/** Which request of an export this is. */
export type ExportStep = "check" | "confirmed" | "unconfirmed";

export const exportStep = (params: URLSearchParams): ExportStep =>
  params.get("check") === "1"
    ? "check"
    : params.get("confirm") === "1"
      ? "confirmed"
      : "unconfirmed";

/** What the check request answers: a line to read, and whether Download is offered. */
export type ExportNotice = Readonly<{ status: "ready" | "refused"; line: string }>;

export const EXPORT_UNCONFIRMED =
  "An export is made only after its notice is confirmed. Use Download or PDF on the thread.";

/** The line for a check that ran (`check`) or could not run (undefined). */
export const exportNoticeLine = (check: FreeTextCheck | undefined): string =>
  check === undefined
    ? "This export could not be checked for stored values. Download anyway?"
    : check.matches.length === 0
      ? "No stored values were found in this export. Download it?"
      : `This export contains: ${describeFreeTextCheck(check)}. Download anyway?`;

/** Reads a check answer back; anything else is null. */
export const parseExportNotice = (value: unknown): ExportNotice | null => {
  if (typeof value !== "object" || value === null) return null;
  const { status, line } = value as Readonly<Record<string, unknown>>;
  return (status === "ready" || status === "refused") && typeof line === "string"
    ? { status, line }
    : null;
};
